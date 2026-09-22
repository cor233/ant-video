(function () {
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

  if (window.ant && window.ant.tv && typeof window.ant.tv.onKey === 'function') {
    window.ant.tv.onKey(function (event) {
      if (!buttons.length) return;
      var index = buttons.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        index = (index + 1) % buttons.length;
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        index = index <= 0 ? buttons.length - 1 : index - 1;
      } else if (event.key === 'Enter' || event.key === 'Select') {
        if (document.activeElement) document.activeElement.click();
        return;
      } else {
        return;
      }
      buttons[index].focus();
      buttons[index].scrollIntoView({block: 'nearest'});
    });
  }
})();
