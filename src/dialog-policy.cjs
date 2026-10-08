'use strict';
/** Share confirmation layout/presentation without changing callers' logical response IDs. */
function cancelOnRight(native, present = (...args) => native.showMessageBox(...args)) {
  return new Proxy(native, { get(target, property) {
    if (property !== 'showMessageBox') {
      const value = target[property]; return typeof value === 'function' ? value.bind(target) : value;
    }
    return async (...args) => {
      const original = args.at(-1);
      if (!Array.isArray(original?.buttons) || original.buttons.length < 2) return present(...args);
      const cancel = original.cancelId;
      if (!Number.isInteger(cancel) || cancel < 0 || cancel >= original.buttons.length) throw new Error('Confirmation needs an explicit Cancel button.');
      const order = original.buttons.map((_, i) => i).filter(i => i !== cancel).concat(cancel);
      const options = { ...original, buttons: order.map(i => original.buttons[i]), cancelId: order.length - 1, defaultId: order.length - 1, noLink: true };
      const result = await present(...args.slice(0, -1), options);
      const response = Number.isInteger(result?.response) && result.response >= 0 && result.response < order.length ? order[result.response] : cancel;
      return { ...result, response };
    };
  } });
}
module.exports = { cancelOnRight };
