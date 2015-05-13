'use strict';

var keywordExtractor = require('keyword-extractor');

var keywordOptions = {
  language: 'english',
  remove_digits: true,
  return_changed_case: true,
  remove_duplicates: true
};

exports = module.exports = function(text) {
  return (keywordExtractor.extract(text, keywordOptions) || []).slice(0, 5);
};
