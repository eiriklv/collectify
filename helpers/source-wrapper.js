'use strict';

const asap = require('asap');

exports = module.exports = function(fn) {
  return function(push, next) {
    fn(function(err, result) {
      push(err, result);
      asap(next);
    });
  };
};
