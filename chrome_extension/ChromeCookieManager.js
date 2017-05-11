
/**
 * Acts as an intermediary between Chrome's cookie API and the extension.
 * The exposed interface is the same as CookieManager, because duck typing is
 * a useful thing.
 *
 * To use this, manifest.json must have "cookies" in its permissions.
 */

const $ = require("jquery");

var self;

/**
 * Creates a new instance of this pseudo-cookiemanager.
 * Instead of actually asking the browser for a cookie every time the get method
 * is invoked, all cookies are gotten upon initialization and stored in an object.
 * The get method of this manager performs a lookup on the object.
 *
 * @param {String} url
 * @param {Function} callback the setup function to be run after cookie initalization completes.
 */
var ChromeCookieManager = function(url, callback) {
	self = this;
	self.url = url;
	self.storedCookies = {};
	chrome.cookies.getAll({
		url: self.url
	}, function(cookies) {
		for(cookie of cookies) {
			// shoot me
			self.storedCookies[cookie.name] = JSON.parse("\"" + lint(cookie.value) + "\"");
		}
		callback();
	});
}

ChromeCookieManager.prototype.set = function(key, value, expires) {
	console.log("in set:");
	console.log("\tkey:", key);
	console.log("\tval:", (typeof value == 'string') ? value : JSON.stringify(value));
	chrome.cookies.set(
		{
			url: self.url,
			name: key,
			value: (typeof value == 'string') ? value : JSON.stringify(value),
			expirationDate: expires ? (daysToSeconds(expires)) : (daysToSeconds(365))
		}, function(cookie) {
			if(!cookie) {
				console.log(cookie);
				throw new Error("AAAHAHAHSHDH");
			}
			self.storedCookies[key] = cookie.value;
		});
	return value;
};

ChromeCookieManager.prototype.get = function(key) {
	return self.storedCookies[key];
};

ChromeCookieManager.prototype.getJSON = function(key) {
	try {
		return JSON.parse(self.get(key));
	}
	catch(e) {
		return undefined;
	}
};

var splitString = function(str, length) {
    var parts = [];
    for (var i = 0; i < str.length; i += length) {
     	parts.push(str.substring(i, i + length));
    }
    return parts;
};
ChromeCookieManager.prototype.getLong = function(key) {
	var longValue = '';
	for (var i = 0; self.get(key + '_' + i); i++) {
		longValue += self.get(key + '_' + i);
	}
	console.log(longValue);
	console.log(i);
	return longValue;
};
ChromeCookieManager.prototype.getLongJSON = function(key) {
	return JSON.parse(self.getLong(key));
};
ChromeCookieManager.prototype.setLong = function(key, longValue, expires) {
	if (typeof longValue != 'string')
		longValue = JSON.stringify(longValue);
	var parts = splitString(longValue, 1500);
	for (var i = 0; i < parts.length; i++) {
		// console.log("in setlong:", parts[i]);
		self.set(key + '_' + i, parts[i], expires);
	}
	// clears unused cookies
	for(j = i; j < self.get(key + "_" + j); j++) {
		chrome.cookies.remove({
			url: self.url,
			name: key + "_" + j
		}, function(cookie) {
			delete self.storedCookies[cookie.name];
		});
	}
};

/**
 * Because the CookieManager class was written to take days until expiration
 * as an argument of set, and chrome.cookies sets an expiration date in terms
 * of seconds elapsed since the unix epoch, this is necessary.
 *
 * @param {int} days the number of days until expiration.
 * @return {double} the date of expiration, in terms of number of seconds since
 * the unix epoch.
 */
var daysToSeconds = function(days) {
	var d = new Date();
	d.setDate(days);
	return d.getTime() / 1000;
};

var lint = function(str) {
	str = decodeURI(str);
	str = str.replace(/\"/g,"\\\"");
	return str; 
}

module.exports = ChromeCookieManager;