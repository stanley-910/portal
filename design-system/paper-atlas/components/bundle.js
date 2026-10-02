/* @ds-bundle: {"format":4,"namespace":"PaperAtlas","components":[{"name":"Button"},{"name":"RoundButton"},{"name":"Panel"},{"name":"PlaceHeader"},{"name":"Ticket"},{"name":"Tag"},{"name":"Sticker"},{"name":"Route"},{"name":"Cursor"}]} */
(function () {
  var React = window.React;
  var h = React.createElement;

  function cx() {
    var out = [];
    for (var i = 0; i < arguments.length; i++) if (arguments[i]) out.push(arguments[i]);
    return out.join(' ');
  }

  var PLANE_D = 'M0 -20 C3 -20 4 -16 4 -12 L4 -5 L19 3 L19 7.5 L4 3.5 L3 12 L9 16 L9 19.5 L0 17.5 ' +
    'L-9 19.5 L-9 16 L-3 12 L-4 3.5 L-19 7.5 L-19 3 L-4 -5 L-4 -12 C-4 -16 -3 -20 0 -20 Z';

  function starD(R) {
    var d = '';
    for (var i = 0; i < 16; i++) {
      var a = (i * Math.PI) / 8 - Math.PI / 2;
      var r = i % 2 === 0 ? R : R * 0.34;
      d += (i ? ' L' : 'M') + (Math.cos(a) * r).toFixed(2) + ' ' + (Math.sin(a) * r).toFixed(2);
    }
    return d + ' Z';
  }

  var uid = 0;

  function Sticker(props) {
    var shape = props.shape === 'plane' ? 'plane' : 'star';
    var size = props.size || (shape === 'plane' ? 44 : 28);
    var rotate = props.rotate || 0;
    var idRef = React.useRef(null);
    if (idRef.current === null) idRef.current = 'pa-star-' + (++uid);
    var label = props.title;
    var body;
    if (shape === 'plane') {
      body = [
        h('path', { key: 'f', className: 'pa-sticker-face', d: PLANE_D }),
        h('path', { key: 'c', className: 'pa-sticker-detail', d: 'M-2.3 -13.5 Q0 -16.2 2.3 -13.5' }),
        h('circle', { key: 'l', className: 'pa-roundel', cx: -12, cy: 3.4, r: 1.8 }),
        h('circle', { key: 'r', className: 'pa-roundel', cx: 12, cy: 3.4, r: 1.8 })
      ];
    } else {
      var d = starD(20);
      body = [
        h('defs', { key: 'g' },
          h('radialGradient', { id: idRef.current, cx: 0, cy: 0, r: 20, gradientUnits: 'userSpaceOnUse' },
            h('stop', { offset: '0', className: 'pa-star-light' }),
            h('stop', { offset: '1', className: 'pa-star-edge' }))),
        h('path', { key: 'f', className: 'pa-sticker-face', d: d, style: { fill: 'url(#' + idRef.current + ')' } })
      ];
    }
    return h('svg', {
      className: cx('pa-sticker pa-cast', props.className),
      width: size, height: size, viewBox: '-26 -26 52 52',
      role: label ? 'img' : undefined,
      'aria-label': label || undefined,
      'aria-hidden': label ? undefined : 'true',
      style: Object.assign({ '--alt': props.altitude != null ? props.altitude : (shape === 'plane' ? 0.5 : 0) }, props.style)
    }, h('g', { transform: rotate ? 'rotate(' + rotate + ')' : undefined }, body)); // rotated inside, so the shadow keeps falling along the light
  }

  function Tag(props) {
    return h('span', { className: cx('pa-tag', props.className), style: props.style }, props.children);
  }

  function Route(props) {
    var w = props.width || 96, hgt = props.height || 28;
    var lift = props.lift == null ? 1 : props.lift;
    var y0 = hgt - 5, top = y0 - (hgt + 4) * lift;
    return h('svg', { className: cx('pa-route', props.marching && 'pa-route-marching', props.className), width: w, height: hgt, viewBox: '0 0 ' + w + ' ' + hgt, 'aria-hidden': 'true' },
      h('path', { d: 'M3 ' + y0 + ' Q' + w / 2 + ' ' + top.toFixed(1) + ' ' + (w - 3) + ' ' + y0 }));
  }

  function RoundButton(props) {
    return h('button', {
      type: 'button',
      className: cx('pa-round', props.className),
      'aria-label': props.label || 'Close',
      onClick: props.onClick,
      style: props.style
    }, h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': 'true' },
      h('path', { d: 'M2 2 L12 12 M12 2 L2 12' })));
  }

  function Button(props) {
    var variant = props.variant === 'secondary' || props.variant === 'quiet' ? props.variant : 'primary';
    return h('button', {
      type: props.type || 'button',
      className: cx('pa-btn', 'pa-btn-' + variant, props.block && 'pa-btn-block', props.className),
      disabled: props.disabled,
      onClick: props.onClick,
      style: props.style,
      'aria-label': props['aria-label']
    }, props.icon ? h('span', { className: 'pa-btn-icon', 'aria-hidden': 'true' }, props.icon) : null,
      props.children ? h('span', null, props.children) : null);
  }

  function Panel(props) {
    return h('section', {
      className: cx('pa-panel', props.className),
      style: props.style,
      'aria-label': props['aria-label']
    }, props.onClose ? h(RoundButton, { className: 'pa-panel-close', label: props.closeLabel || 'Close', onClick: props.onClose }) : null,
      props.children);
  }

  function PlaceHeader(props) {
    var Tag_ = props.as || 'h2';
    return h('div', { className: cx('pa-place', props.className), style: props.style },
      props.eyebrow ? h('div', { className: 'pa-place-eyebrow' }, props.eyebrow) : null,
      h(Tag_, { className: 'pa-place-name' }, props.name),
      props.detail ? h('div', { className: 'pa-place-detail' }, props.detail) : null);
  }

  function Ticket(props) {
    var from = props.from || {}, to = props.to || {};
    var searching = props.searching !== false;
    var col = function (p) {
      return h('div', { className: 'pa-ticket-place' },
        h('div', { className: 'pa-ticket-code' }, p.code),
        h('div', { className: 'pa-ticket-city' }, p.city));
    };
    return h('div', { className: cx('pa-ticket', props.flat && 'pa-ticket-flat', props.className), style: props.style },
      h('div', { className: 'pa-ticket-main' }, col(from), h(Route, { marching: searching }), col(to)),
      h('div', { className: 'pa-ticket-stub' },
        h('div', { className: 'pa-ticket-date' }, props.date),
        props.distance ? h('div', { className: 'pa-ticket-meta' }, props.distance) : null,
        searching ? h('div', { className: 'pa-dots', role: 'status', 'aria-label': 'Searching' },
          h('span'), h('span'), h('span')) : null),
      props.onClose ? h(RoundButton, { className: 'pa-ticket-close', label: props.closeLabel || 'Cancel trip', onClick: props.onClose }) : null);
  }


  // Cursor: another member's pointer, a sticker in their colour. Tip (the hotspot) at 0 0.
  var ARROW_D = 'M0 0 L0 18 L4.6 14 L7.8 21 L11 19.6 L7.9 12.8 L13.6 12.6 Z';
  var CURSOR_SHAPES = {
    arrow: { outline: ARROW_D, parts: [{ d: ARROW_D, paint: 'member' }] },
    compass: {
      outline: 'M0 0 L3.8 11 L0 25 L-3.8 11 Z', transform: 'rotate(-24)',
      parts: [
        { d: 'M0 0 L3.8 11 L-3.8 11 Z', paint: 'member' },
        { d: 'M-3.8 11 L3.8 11 L0 25 Z', paint: 'face' },
        { d: 'M0 0 L3.8 11 L0 11 Z M0 11 L3.8 11 L0 25 Z', paint: 'shade' },
        { d: 'M-1.5 11 a1.5 1.5 0 1 0 3 0 a1.5 1.5 0 1 0 -3 0 Z', paint: 'ink' }
      ]
    },
    map: {
      outline: ARROW_D,
      parts: [
        { d: ARROW_D, paint: 'member' },
        { d: 'M0 6.5 L6.5 0 L13 6.5 L0 19.5 Z', paint: 'shade' },
        { d: 'M2.2 15.2 L6.2 9.4 L9.4 11.4', paint: 'dashed' }
      ]
    }
  };
  var MEMBER_COLORS = ['member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6'];
  function memberColor(slot) {
    var n = MEMBER_COLORS.length;
    return MEMBER_COLORS[((Math.trunc(slot) % n) + n) % n];
  }

  function Cursor(props) {
    var def = CURSOR_SHAPES[props.shape] || CURSOR_SHAPES.arrow;
    var color = props.color || 'member-1';
    var idRef = React.useRef(null);
    if (idRef.current === null) idRef.current = 'pa-cursor-' + (++uid);
    var style = Object.assign({ '--member': 'var(--' + color + ')', '--alt': props.altitude != null ? props.altitude : 0.5, transform: 'translate(' + (props.x || 0) + 'px, ' + (props.y || 0) + 'px)' }, props.style);
    return h('div', { className: cx('pa-cursor pa-cast', props.className), style: style, 'aria-hidden': true },
      h('svg', { className: 'pa-cursor-sticker', width: 40, height: 40, viewBox: '-2 -2 40 40' },
        h('defs', null, h('clipPath', { id: idRef.current }, h('path', { d: def.outline }))),
        h('g', { transform: def.transform },
          h('g', { clipPath: 'url(#' + idRef.current + ')' },
            def.parts.map(function (p, i) { return h('path', { key: i, className: 'pa-cursor-' + p.paint, d: p.d }); })),
          h('path', { className: 'pa-cursor-outline', d: def.outline }))),
      props.name ? h('span', { className: 'pa-cursor-name' }, props.name) : null);
  }

  window.PaperAtlas = Object.assign(window.PaperAtlas || {}, {
    Button: Button, RoundButton: RoundButton, Panel: Panel, PlaceHeader: PlaceHeader, Ticket: Ticket, Tag: Tag, Sticker: Sticker, Route: Route, Cursor: Cursor, memberColor: memberColor, MEMBER_COLORS: MEMBER_COLORS
  });
})();
