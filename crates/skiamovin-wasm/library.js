// emscripten JS library: callbacks from Rust into JavaScript.
addToLibrary({
  skm_js_measure: function (cb, node, kw, kh, aw, ah, out) {
    Module.__skm_measure(cb, node, kw, kh, aw, ah, out);
  },
});
