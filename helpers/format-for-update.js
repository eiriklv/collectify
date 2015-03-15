'use strict';

const _ = require('lodash-fp');
const asap = require('asap');
const debug = require('debug')('format-for-updating');

exports = module.exports = function(picks) {
  return function(obj, callback) {
    asap(callback.bind(this, null, _.pick(picks, obj), obj))
  };
};
