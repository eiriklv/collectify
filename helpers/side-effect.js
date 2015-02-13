'use strict';

exports = module.exports = function(fn) {
  return function(value) {
    fn.call(this, value);
    return value;
  };
};
