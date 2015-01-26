exports = module.exports = [{
  "active": true,
  "type": "feed",
  "name": "TheWireCutter",
  "url": "http://feeds.feedburner.com/TheWirecutter",
  "template": {
    "elements": [{
      "name": "guid",
      "type": "url",
      "required": true,
      "items": [{
        "selector": "guid"
      }, {
        "selector": "link"
      }, {
        "selector": "title",
        "decode": true
      }]
    }, {
      "name": "title",
      "required": true,
      "items": [{
        "selector": "title",
        "decode": true
      }]
    }, {
      "name": "url",
      "type": "url",
      "required": true,
      "items": [{
        "selector": "link"
      }]
    }, {
      "name": "image",
      "type": "url",
      "items": [{
        "selector": "enclosures[0].url"
      }],
      "fallback": "http://thewirecutter.wpengine.netdna-cdn.com/wp-content/themes/thewirecutter/thewirecutter/img/logo/header.png"
    }]
  }
}, {
  "active": true,
  "type": "json",
  "name": "Mashable",
  "url": "http://mashable.com/stories.json?hot_per_page=0&new_per_page=30&rising_per_page=0",
  "listref": "new",
  "template": {
    "elements": [{
      "name": "guid",
      "type": "url",
      "required": true,
      "items": [{
        "selector": "link"
      }]
    }, {
      "name": "title",
      "required": true,
      "items": [{
        "selector": "title"
      }]
    }, {
      "name": "url",
      "type": "url",
      "required": true,
      "items": [{
        "selector": "link"
      }]
    }, {
      "name": "image",
      "type": "url",
      "items": [{
        "selector": "responsive_images[1].image"
      }, {
        "selector": "responsive_images[0].image"
      }],
      "fallback": "http://rack.1.mshcdn.com/assets/header_share_logo.v2-11a2e0632ddb46b143c85e63f590734d.png"
    }]
  }
}, {
  "active": true,
  "type": "site",
  "name": "New Yorker",
  "url": "http://www.newyorker.com/",
  "format": "desktop",
  "template": {
    "containers": [{
      "selector": "article",
      "elements": [{
        "name": "guid",
        "type": "url",
        "occurence": "first",
        "required": true,
        "items": [{
          "selector": "section h2 a",
          "attribute": "href"
        }]
      }, {
        "name": "url",
        "type": "url",
        "occurence": "first",
        "required": true,
        "items": [{
          "selector": "section h2 a",
          "attribute": "href"
        }]
      }, {
        "name": "title",
        "required": true,
        "occurence": "first",
        "items": [{
          "selector": "section h2 a"
        }]
      }, {
        "name": "image",
        "type": "url",
        "occurence": "first",
        "fallback": null,
        "items": [{
          "selector": "figure a img",
          "attribute": "src"
        }, {
          "selector": "figure a img",
          "attribute": "data-lazy-src"
        }]
      }]
    }]
  }
}];
