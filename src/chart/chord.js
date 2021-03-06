/**
 * echarts图表类：chord diagram
 *
 * @author pissang (https://github.com/pissang/)
 * 
 * TODO undirected graph ?
 */

define(function (require) {
    'use strict';
    
    var ComponentBase = require('../component/base');
    var ChartBase = require('./base');
    
    // 图形依赖
    var TextShape = require('zrender/shape/Text');
    var LineShape = require('zrender/shape/Line');
    var SectorShape = require('zrender/shape/Sector');
    var RibbonShape = require('../util/shape/Ribbon');
    var CircleShape = require('zrender/shape/Circle');
    var IconShape = require('../util/shape/Icon');
    var BezierCurveShape = require('zrender/shape/BezierCurve');
    
    var ecConfig = require('../config');
    var ecData = require('../util/ecData');
    var zrUtil = require('zrender/tool/util');
    var vec2 = require('zrender/tool/vector');
    var Graph = require('../data/Graph');
    var ChordLayout = require('../layout/Chord');
    
    var _devicePixelRatio = window.devicePixelRatio || 1;
    
    function Chord(ecTheme, messageCenter, zr, option, myChart) {
        // 基类
        ComponentBase.call(this, ecTheme, messageCenter, zr, option, myChart);
        // 图表基类
        ChartBase.call(this);

        this.scaleLineLength = 4;

        this.scaleUnitAngle = 4;

        this.refresh(option);
    }
    
    Chord.prototype = {
        type: ecConfig.CHART_TYPE_CHORD,
        /**
         * 绘制图形
         */
        _init: function () {
            var series = this.series;
            this.selectedMap = {};

            var chordSeriesMap = {};

            var chordSeriesGroups = {};

            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].type === this.type) {
                    var _isSelected = this.isSelected(series[i].name);
                    // Filter by selected serie
                    this.selectedMap[series[i].name] = _isSelected;
                    if (_isSelected) {
                        this.buildMark(i);
                    }

                    chordSeriesMap[series[i].name] = series[i];
                }
            }
            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].type === this.type) {
                    if (series[i].insertToSerie) {
                        var referenceSerie = chordSeriesMap[series[i].insertToSerie];
                        series[i]._referenceSerie = referenceSerie;
                    } else {
                        chordSeriesGroups[series[i].name] = [series[i]];
                        this.reformOption(series[i]);
                    }
                }
            }
            for (var i = 0, l = series.length; i < l; i++) {
                if (series[i].type === this.type) {
                    if (series[i].insertToSerie) {
                        // insertToSerie 可能会存在链式的使用，找到最原始的系列，分到一个 Group 里
                        var mainSerie = series[i]._referenceSerie;
                        while (mainSerie && mainSerie._referenceSerie) {
                            mainSerie = mainSerie._referenceSerie;
                        }
                        if (
                            chordSeriesGroups[mainSerie.name]
                            && this.selectedMap[series[i].name]
                        ) {
                            chordSeriesGroups[mainSerie.name].push(series[i]);
                        }
                    }
                }
            }

            for (var name in chordSeriesGroups) {
                this._buildChords(chordSeriesGroups[name]);
            }
            
            this.addShapeList();
        },

        _buildChords: function (series) {
            var graphs = [];
            for (var i = 0; i < series.length; i++) {
                var serie = series[i];

                if (this.selectedMap[serie.name]) {
                    if (serie.data && serie.matrix) {
                        var graph = this._getSerieGraphFromDataMatrix(serie);
                        graphs.push(graph);
                    } else if (serie.nodes && serie.links) {
                        var graph = this._getSerieGraphFromNodeLinks(serie);
                        graphs.push(graph);
                    }
                }
            }
            if (!graphs.length) {
                return;
            }

            var mainSerie = series[0];

            // Do layout
            var layout = new ChordLayout();
            layout.clockWise = mainSerie.clockWise;
            layout.startAngle = mainSerie.startAngle * Math.PI / 180;
            if (!layout.clockWise) {
                layout.startAngle = -layout.startAngle;
            }
            layout.padding = mainSerie.padding * Math.PI / 180;
            layout.sort = mainSerie.sort;
            layout.sortSub = mainSerie.sortSub;
            layout.run(graphs);

            var showLabel = this.query(
                mainSerie, 'itemStyle.normal.label.show'
            );

            if (mainSerie.ribbonType) {
                this._buildSectors(mainSerie, 0, graphs[0], mainSerie, graphs);
                if (showLabel) {
                    this._buildLabels(mainSerie, 0, graphs[0], mainSerie, graphs);
                }

                for (var i = 0; i < graphs.length; i++) {
                    this._buildRibbons(series[i], i, graphs[i], mainSerie);
                }

                if (serie.showScale) {
                    this._buildScales(mainSerie, 0, graph);
                }
            }
        },

        _getSerieGraphFromDataMatrix: function (serie) {
            var nodesData = [];
            var count = 0;
            var matrix = [];
            // 复制一份新的matrix
            for (var i = 0; i < serie.matrix.length; i++) {
                matrix[i] = serie.matrix[i].slice();
            }
            for (var i = 0; i < serie.data.length; i++) {
                var node = {};
                var group = serie.data[i];
                for (var key in group) {
                    // name改为id
                    if (key === 'name') {
                        node['id'] = group['name'];
                    }
                    else {
                        node[key] = group[key];
                    }
                }
                this.selectedMap[group.name] = this.isSelected(group.name);
                if (this.selectedMap[group.name]) {
                    nodesData.push(node);
                    count++;
                } else {
                    // 过滤legend未选中的数据
                    matrix.splice(count, 1);
                    for (var j = 0; j < matrix.length; j++) {
                        matrix[j].splice(count, 1);
                    }
                }
            }

            var graph = Graph.fromMatrix(nodesData, matrix, true);

            // Prepare layout parameters
            graph.eachNode(function (n, idx) {
                n.layout = {
                    size: n.data.outValue
                };
                n.rawIndex = idx;
            });
            graph.eachEdge(function (e) {
                e.layout = {
                    weight: e.data.weight,
                };
            });

            // 过滤输出为0的节点
            graph.filterNode(function (n) {
                return n.layout.size > 0;
            }, this);

            return graph;
        },

        _getSerieGraphFromNodeLinks: function (serie) {
            var graph = new Graph(true);

            for (var i = 0, len = serie.nodes.length; i < len; i++) {
                var n = serie.nodes[i];
                if (!n || n.ignore) {
                    continue;
                }
                this.selectedMap[n.name] = this.isSelected(n.name);
                if (this.selectedMap[n.name]) {
                    var node = graph.addNode(n.name, n);
                    node.rawIndex = i;
                }
            }

            for (var i = 0, len = serie.links.length; i < len; i++) {
                var e = serie.links[i];
                var n1 = e.source;
                var n2 = e.target;
                if (typeof(n1) === 'number') {
                    n1 = serie.nodes[n1];
                    if (n1) {
                        n1 = n1.name;
                    }
                }
                if (typeof(n2) === 'number') {
                    n2 = serie.nodes[n2];
                    if (n2) {
                        n2 = n2.name;
                    }
                }
                var edge = graph.addEdge(n1, n2, e);
                if (edge) {
                    edge.rawIndex = i;
                }
            }

            graph.eachNode(function (n) {
                var value = n.data.value;
                if (!value) {
                    value = 0;
                    // 默认使用所有出边值的和作为节点的大小, 不修改 data 里的数值
                    for (var i = 0; i < n.outEdges.length; i++) {
                        value += n.outEdges[i].data.weight || 0;
                    }
                }
                n.layout = {
                    size: value
                };
            });
            graph.eachEdge(function (e) {
                e.layout = {
                    weight: e.data.weight
                };
            });

            // 过滤输出为0的节点
            graph.filterNode(function (n) {
                return n.layout.size > 0;
            }, this);

            return graph;
        },

        _buildSectors: function (serie, serieIdx, graph, mainSerie, graphs) {
            var timeout;

            var self = this;
            var center = this.parseCenter(this.zr, mainSerie.center);
            var radius = this.parseRadius(this.zr, mainSerie.radius);
            var clockWise = mainSerie.clockWise;
            var sign = clockWise ? 1 : -1;

            graph.eachNode(function (node) {
                var startAngle = node.layout.startAngle / Math.PI * 180 * sign;
                var endAngle = node.layout.endAngle / Math.PI * 180 * sign;
                var sector = new SectorShape({
                    zlevel: this.getZlevelBase(),
                    style: {
                        x: center[0],
                        y: center[1],
                        r0: radius[0],
                        r: radius[1],
                        startAngle: startAngle,
                        endAngle: endAngle,
                        brushType: 'fill',
                        opacity: 1,
                        color: this.getColor(node.id),
                        clockWise: clockWise
                    },
                    clickable: mainSerie.clickable,
                    highlightStyle: {
                        brushType: 'fill'
                    },
                    onmouseover: function () {
                        graph.eachNode(function (n) {
                            n.shape.style.opacity = 0.1;
                            if (n.labelShape) {
                                n.labelShape.style.opacity = 0.1;
                                n.labelShape.modSelf();
                            }
                            n.shape.modSelf();
                        });
                        for (var i = 0; i < graphs.length; i++) {
                            graphs[i].eachEdge(function (e) {
                                e.shape.style.opacity = 0.1;
                                e.shape.modSelf();
                            });
                        }
                        node.shape.style.opacity = 1;
                        if (node.labelShape) {
                            node.labelShape.style.opacity = 1;
                        }
                        for (var i = 0; i < graphs.length; i++) {
                            var n = graphs[i].getNodeById(node.id);
                            if (n) {    //  节点有可能没数据被过滤掉了
                                for (var j = 0; j < n.outEdges.length; j++) {
                                    var e = n.outEdges[j];
                                    e.shape.style.opacity = 0.7;
                                    var other = graphs[0].getNodeById(e.node2.id);
                                    if (other) {
                                        if (other.shape) {
                                            other.shape.style.opacity = 1;
                                        }
                                        if (other.labelShape) {
                                            other.labelShape.style.opacity = 1;
                                        }
                                    }
                                }
                            }
                        }
                        self.zr.refreshNextFrame();
                    },
                    onmouseout: function () {
                        graph.eachNode(function (n) {
                            n.shape.style.opacity = 1;
                            if (n.labelShape) {
                                n.labelShape.style.opacity = 1;
                                n.labelShape.modSelf();
                            }
                            n.shape.modSelf();
                        });
                        for (var i = 0; i < graphs.length; i++) {
                            graphs[i].eachEdge(function (e) {
                                e.shape.style.opacity = 0.7;
                                e.shape.modSelf();
                            });
                        }
                        self.zr.refreshNextFrame();
                    }
                });
                sector.style.lineWidth = this.deepQuery(
                    [node.data, mainSerie],
                    'itemStyle.normal.lineStyle.width'
                );
                sector.highlightStyle.lineWidth = this.deepQuery(
                    [node.data, mainSerie],
                    'itemStyle.emphasis.lineStyle.width'
                );
                sector.style.strokeColor = this.deepQuery(
                    [node.data, mainSerie],
                    'itemStyle.normal.lineStyle.color'
                );
                sector.highlightStyle.strokeColor = this.deepQuery(
                    [node.data, mainSerie],
                    'itemStyle.emphasis.lineStyle.color'
                );
                if (sector.style.lineWidth > 0) {
                    sector.style.brushType = 'both';
                }
                if (sector.highlightStyle.lineWidth > 0) {
                    sector.highlightStyle.brushType = 'both';
                }
                ecData.pack(
                    sector,
                    serie,
                    serieIdx,
                    node.data.value, node.rawIndex,
                    node.id
                );

                this.shapeList.push(sector);

                node.shape = sector;

            }, this);
        },

        _buildLabels: function (serie, serieIdx, graph, mainSerie) {
            var labelColor = this.query(
                mainSerie, 'itemStyle.normal.label.color'
            );
            var rotateLabel = this.query(
                mainSerie, 'itemStyle.normal.label.rotate'
            );
            var labelDistance = this.query(
                mainSerie, 'itemStyle.normal.label.distance'
            );
            var center = this.parseCenter(this.zr, mainSerie.center);
            var radius = this.parseRadius(this.zr, mainSerie.radius);
            var clockWise = mainSerie.clockWise;
            var sign = clockWise ? 1 : -1;

            graph.eachNode(function (node) {
                var startAngle = node.layout.startAngle / Math.PI * 180 * sign;
                var endAngle = node.layout.endAngle / Math.PI * 180 * sign;
                var angle = [startAngle * -sign + endAngle * -sign] / 2;
                angle %= 360;
                if (angle < 0) { // Constrain to [0,360]
                    angle += 360;
                }
                var isRightSide = angle <= 90
                                 || angle >= 270;
                angle = angle * Math.PI / 180;
                var v = [Math.cos(angle), -Math.sin(angle)];

                var distance = mainSerie.showScaleText ? 35 + labelDistance : labelDistance;
                var start = vec2.scale([], v, radius[1] + distance);
                vec2.add(start, start, center);

                var labelShape = {
                    zlevel: this.getZlevelBase() - 1,
                    hoverable: false,
                    style: {
                        text: node.id,
                        textAlign: isRightSide ? 'left' : 'right',
                        color: labelColor
                    }
                };
                if (rotateLabel) {
                    labelShape.rotation = isRightSide ? angle : Math.PI + angle;
                    if (isRightSide) {
                        labelShape.style.x = radius[1] + distance;
                    }
                    else {
                        labelShape.style.x = -radius[1] - distance;
                    }
                    labelShape.style.y = 0;
                    labelShape.position = center.slice();
                }
                else {
                    labelShape.style.x = start[0];
                    labelShape.style.y = start[1];
                }
                labelShape.style.textColor = this.deepQuery(
                    [node.data, mainSerie],
                    'itemStyle.normal.label.textStyle.color'
                ) || '#fff';
                labelShape.style.textFont = this.getFont(this.deepQuery(
                    [node.data, mainSerie],
                    'itemStyle.normal.label.textStyle'
                ));
                labelShape = new TextShape(labelShape);

                this.shapeList.push(labelShape);
                node.labelShape = labelShape;
            }, this);
        },

        _buildIcons: function (serie, serieIdx, graph, mainSerie, graphs) {

        },

        _buildRibbons : function (serie, serieIdx, graph, mainSerie) {
            var ribbonLineStyle 
                = mainSerie.itemStyle.normal.chordStyle.lineStyle;
            var ribbonLineStyleEmphsis
                = mainSerie.itemStyle.emphasis.chordStyle.lineStyle;

            var center = this.parseCenter(this.zr, mainSerie.center);
            var radius = this.parseRadius(this.zr, mainSerie.radius);

            // graph.edges.length = 1;
            graph.eachEdge(function (edge) {
                var color;
                // 反向边
                var other = graph.getEdge(edge.node2, edge.node1);
                if (!other  // 只有单边
                    || edge.shape // 已经创建过Ribbon
                ) {
                    return;
                }
                if (other.shape) { // 已经创建过Ribbon
                    edge.shape = other.shape;
                    return;
                }
                var s0 = edge.layout.startAngle / Math.PI * 180;
                var s1 = edge.layout.endAngle / Math.PI * 180;

                var t0 = other.layout.startAngle / Math.PI * 180;
                var t1 = other.layout.endAngle / Math.PI * 180;

                // 取小端的颜色
                if (edge.layout.weight <= other.layout.weight) {
                    color = this.getColor(edge.node1.id);
                }
                else {
                    color = this.getColor(edge.node2.id);
                }
                var ribbon = new RibbonShape({
                    zlevel: this.getZlevelBase(),
                    style: {
                        x: center[0],
                        y: center[1],
                        r: radius[0],
                        source0: s0,
                        source1: s1,
                        target0: t0,
                        target1: t1,
                        brushType: 'both',
                        opacity: 0.5,
                        color: color,
                        lineWidth: ribbonLineStyle.width,
                        strokeColor: ribbonLineStyle.color,
                        clockWise: mainSerie.clockWise
                    },
                    clickable: mainSerie.clickable,
                    highlightStyle: {
                        brushType: 'both',
                        lineWidth: ribbonLineStyleEmphsis.width,
                        strokeColor: ribbonLineStyleEmphsis.color
                    }
                });

                ecData.pack(
                    ribbon,
                    serie,
                    serieIdx,
                    edge.data.weight,
                    edge.node1.rawIndex + '-' + edge.node2.rawIndex,
                    edge.node1.id,
                    edge.node2.id,
                    edge.data.weight,
                    other.data.weight
                );

                this.shapeList.push(ribbon);
                edge.shape = ribbon;
            }, this);
        },

        _buildScales: function (serie, serieIdx, graph) {
            var clockWise = serie.clockWise;
            var center = this.parseCenter(this.zr, serie.center);
            var radius = this.parseRadius(this.zr, serie.radius);
            var sign = clockWise ? 1 : -1;

            var sumValue = 0;
            var maxValue = -Infinity;
            var unitPostfix;
            var unitScale;

            if (serie.showScaleText) {
                graph.eachNode(function (node) {
                    var val = node.data.value;
                    if (val > maxValue) {
                        maxValue = val;
                    }
                    sumValue += val;
                });
                if (maxValue > 1e10) {
                    unitPostfix  = 'b';
                    unitScale = 1e-9;
                }
                else if (maxValue > 1e7) {
                    unitPostfix = 'm';
                    unitScale = 1e-6;
                }
                else if (maxValue > 1e4) {
                    unitPostfix = 'k';
                    unitScale = 1e-3;
                }
                else {
                    unitPostfix = '';
                    unitScale = 1;
                }
            }

            var unitValue = sumValue / (360 - serie.padding);

            graph.eachNode(function (node) {
                var startAngle = node.layout.startAngle / Math.PI * 180;
                var endAngle = node.layout.endAngle / Math.PI * 180;
                var scaleAngle = startAngle;
                while (true) {
                    if ((clockWise && scaleAngle > endAngle)
                        || (!clockWise && scaleAngle < endAngle)
                    ) {
                        break;
                    }
                    var theta = scaleAngle / 180 * Math.PI;
                    var v = [Math.cos(theta), Math.sin(theta)];
                    var start = vec2.scale([], v, radius[1] + 1);
                    vec2.add(start, start, center);
                    var end = vec2.scale([], v, radius[1] + this.scaleLineLength);
                    vec2.add(end, end, center);
                    var scaleShape = new LineShape({
                        zlevel: this.getZlevelBase() - 1,
                        hoverable: false,
                        style: {
                            xStart: start[0],
                            yStart: start[1],
                            xEnd: end[0],
                            yEnd: end[1],
                            lineCap: 'round',
                            brushType: 'stroke',
                            strokeColor: '#666',
                            lineWidth: 1
                        }
                    });

                    this.shapeList.push(scaleShape);

                    scaleAngle += sign * this.scaleUnitAngle;
                }
                if (!serie.showScaleText) {
                    return;
                }

                var scaleTextAngle = startAngle;
                var step = unitValue * 5 * this.scaleUnitAngle;
                var scaleValue = 0;
                while (true) {
                    if ((clockWise && scaleTextAngle > endAngle)
                        || (!clockWise && scaleTextAngle < endAngle)
                    ) {
                        break;
                    }
                    var theta = scaleTextAngle;
                    theta = theta % 360;
                    if (theta < 0) {
                        theta += 360;
                    }
                    var isRightSide = theta <= 90
                                     || theta >= 270;

                    var textShape = new TextShape({
                        zlevel: this.getZlevelBase() - 1,
                        hoverable: false,
                        style: {
                            x: isRightSide 
                                    ? radius[1] + this.scaleLineLength + 4 
                                    : -radius[1] - this.scaleLineLength - 4,
                            y: 0,
                            text: Math.round(scaleValue * 10) / 10 
                                    + unitPostfix,
                            textAlign: isRightSide ? 'left' : 'right'
                        },
                        position: center.slice(),
                        rotation: isRightSide
                            ? [-theta / 180 * Math.PI, 0, 0]
                            : [
                                -(theta + 180) / 180 * Math.PI,
                                0, 0
                              ]
                    });

                    this.shapeList.push(textShape);

                    scaleValue += step * unitScale;
                    scaleTextAngle += sign * this.scaleUnitAngle * 5;
                }
            }, this);
        },

        refresh : function (newOption) {
            if (newOption) {
                this.option = newOption;
                this.series = newOption.series;
            }
            
            this.legend = this.component.legend;
            if (this.legend) {
                this.getColor = function(param) {
                    return this.legend.getColor(param);
                };
                this.isSelected = function(param) {
                    return this.legend.isSelected(param);
                };
            }
            else {
                var colorIndices = {};
                var colorMap = {};
                var count = 0;
                this.getColor = function (key) {
                    if (colorMap[key]) {
                        return colorMap[key];
                    }
                    if (colorIndices[key] === undefined) {
                        colorIndices[key] = count++;
                    }
                    // key is serie name
                    for (var i = 0; i < this.chordSeries.length; i++) {
                        if (this.chordSeries[i].name === key) {
                            colorMap[key] = this.query(
                                this.chordSeries[i],
                                'itemStyle.normal.color'
                            );
                            break;
                        }
                    }
                    if (!colorMap[key]) {
                        var len = this.groups.length;
                        // key is group name
                        for (var i = 0; i < len; i++) {
                            if (this.groups[i].name === key) {
                                colorMap[key] = this.query(
                                    this.groups[i],
                                    'itemStyle.normal.color'
                                );
                                break;
                            }
                        }
                    }
                    if (!colorMap[key]) {
                        colorMap[key] = this.zr.getColor(colorIndices[key]);
                    }

                    return colorMap[key];
                };
                this.isSelected = function () {
                    return true;
                };
            }
            
            this.backupShapeList();
            this._init();
        },

        reformOption : function (opt) {
            var _merge = zrUtil.merge;
            opt = _merge(
                      opt || {},
                      this.ecTheme.chord
                  );
            opt.itemStyle.normal.label.textStyle = _merge(
                opt.itemStyle.normal.label.textStyle || {},
                this.ecTheme.textStyle
            );
        }
    };
    
    zrUtil.inherits(Chord, ChartBase);
    zrUtil.inherits(Chord, ComponentBase);
    
    // 图表注册
    require('../chart').define('chord', Chord);

    return Chord;
});