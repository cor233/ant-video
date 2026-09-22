(function () {
  // Node 服务型小程序不在页面内承载业务，但仍注册遥控事件，避免 TV WebView 丢失焦点事件。
  if (window.ant && window.ant.tv && typeof window.ant.tv.onKey === 'function') {
    window.ant.tv.onKey(function () {
      return false;
    });
  }

  // 复制按钮处理：优先使用 ant.clipboard（Android WebView 下 navigator.clipboard 不可用），
  // 降级为 navigator.clipboard，失败时提示长按复制。
  var buttons = Array.prototype.slice.call(document.querySelectorAll('[data-copy]'));

  function toast(message) {
    if (window.ant && ant.ui && typeof ant.ui.toast === 'function') {
      return ant.ui.toast(message).catch(function () {});
    }
    return Promise.resolve();
  }

  function copy(text) {
    if (window.ant && ant.clipboard && typeof ant.clipboard.set === 'function') {
      return ant.clipboard.set(text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error('clipboard unavailable'));
  }

  buttons.forEach(function (button) {
    button.addEventListener('click', function () {
      var target = document.getElementById(button.getAttribute('data-copy'));
      var value = target ? target.textContent.trim() : '';
      copy(value)
        .then(function () { return toast('接口地址已复制'); })
        .catch(function () { return toast('复制失败，请长按地址复制'); });
    });
  });
})();
