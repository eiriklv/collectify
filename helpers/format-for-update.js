'use strict';

const lodash = require('lodash-fp');
const asap = require('asap');
const debug = require('debug')('format-for-updating');

exports = module.exports = function(picks) {
  return function(obj, callback) {
    asap(callback.bind(this, null, lodash.pick(picks, obj), obj))
  };
};
