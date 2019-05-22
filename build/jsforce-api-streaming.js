(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g=(g.jsforce||(g.jsforce = {}));g=(g.modules||(g.modules = {}));g=(g.api||(g.api = {}));g.Streaming = f()}})(function(){var define,module,exports;return (function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
/**
 * Faye Client extensions: https://faye.jcoglan.com/browser/extensions.html
 *
 * For use with Streaming.prototype.createClient()
**/
var StreamingExtension = {};

/**
 * Constructor for an auth failure detector extension
 *
 * Based on new feature released with Salesforce Spring '18:
 * https://releasenotes.docs.salesforce.com/en-us/spring18/release-notes/rn_messaging_cometd_auth_validation.htm?edition=&impact=
 *
 * Example triggering error message:
 *
 * ```
 * {
 *   "ext":{
 *     "sfdc":{"failureReason":"401::Authentication invalid"},
 *     "replay":true},
 *   "advice":{"reconnect":"none"},
 *   "channel":"/meta/handshake",
 *   "error":"403::Handshake denied",
 *   "successful":false
 * }
 * ```
 *
 * Example usage:
 *
 * ```javascript
 * const conn = new jsforce.Connection({ … });
 * 
 * const channel = "/event/My_Event__e";
 * 
 * // Exit the Node process when auth fails
 * const exitCallback = () => process.exit(1);
 * const authFailureExt = new jsforce.StreamingExtension.AuthFailure(exitCallback);
 * 
 * const fayeClient = conn.streaming.createClient([ authFailureExt ]);
 * 
 * const subscription = fayeClient.subscribe(channel, data => {
 *   console.log('topic received data', data);
 * });
 * 
 * subscription.cancel();
 * ```
 *
 * @param {Function} failureCallback - Invoked when authentication becomes invalid
 */
StreamingExtension.AuthFailure = function(failureCallback) {
  this.incoming = function(message, callback) {
    if (
      (message.channel === '/meta/connect' ||
        message.channel === '/meta/handshake')
      && message.advice
      && message.advice.reconnect == 'none'
    ) {
      failureCallback(message);
    } else {
      callback(message);
    }
  }
};

/**
 * Constructor for a durable streaming replay extension
 *
 * Modified from original Salesforce demo source code:
 * https://github.com/developerforce/SalesforceDurableStreamingDemo/blob/3d4a56eac956f744ad6c22e6a8141b6feb57abb9/staticresources/cometdReplayExtension.resource
 * 
 * Example usage:
 *
 * ```javascript
 * const conn = new jsforce.Connection({ … });
 * 
 * const channel = "/event/My_Event__e";
 * const replayId = -2; // -2 is all retained events
 * 
 * const replayExt = new jsforce.StreamingExtension.Replay(channel, replayId);
 * 
 * const fayeClient = conn.streaming.createClient([ replayExt ]);
 * 
 * const subscription = fayeClient.subscribe(channel, data => {
 *   console.log('topic received data', data);
 * });
 * 
 * subscription.cancel();
 * ```
 */
StreamingExtension.Replay = function(channel, replayId) {
  var REPLAY_FROM_KEY = "replay";
  
  var _extensionEnabled = replayId != null ? true : false;
  var _replay = replayId;
  var _channel = channel;

  this.setExtensionEnabled = function(extensionEnabled) {
    _extensionEnabled = extensionEnabled;
  }

  this.setReplay = function (replay) {
    _replay = parseInt(replay, 10);
  }

  this.setChannel = function(channel) {
    _channel = channel;
  }

  this.incoming = function(message, callback) {
    if (message.channel === '/meta/handshake') {
      if (message.ext && message.ext[REPLAY_FROM_KEY] == true) {
        _extensionEnabled = true;
      }
    } else if (message.channel === _channel && message.data && message.data.event && message.data.event.replayId) {
      _replay = message.data.event.replayId;
    }
    callback(message);
  }
  
  this.outgoing = function(message, callback) {
    if (message.channel === '/meta/subscribe' && message.subscription === _channel) {
      if (_extensionEnabled) {
        if (!message.ext) { message.ext = {}; }

        var replayFromMap = {};
        replayFromMap[_channel] = _replay;

        // add "ext : { "replay" : { CHANNEL : REPLAY_VALUE }}" to subscribe message
        message.ext[REPLAY_FROM_KEY] = replayFromMap;
      }
    }
    callback(message);
  };
};

module.exports = StreamingExtension;

},{}],2:[function(require,module,exports){
/**
 * @file Manages Streaming APIs
 * @author Shinichi Tomita <shinichi.tomita@gmail.com>
 */

'use strict';

var events = window.jsforce.require('events'),
    inherits = window.jsforce.require('inherits'),
    _ = window.jsforce.require('lodash/core'),
    Faye   = require('faye'),
    StreamingExtension = require('./streaming-extension'),
    jsforce = window.jsforce.require('./core');

/**
 * Streaming API topic class
 *
 * @class Streaming~Topic
 * @param {Streaming} steaming - Streaming API object
 * @param {String} name - Topic name
 */
var Topic = function(streaming, name) {
  this._streaming = streaming;
  this.name = name;
};

/**
 * @typedef {Object} Streaming~StreamingMessage
 * @prop {Object} event
 * @prop {Object} event.type - Event type
 * @prop {Record} sobject - Record information
 */
/**
 * Subscribe listener to topic
 *
 * @method Streaming~Topic#subscribe
 * @param {Callback.<Streaming~StreamingMesasge>} listener - Streaming message listener
 * @returns {Subscription} - Faye subscription object
 */
Topic.prototype.subscribe = function(listener) {
  return this._streaming.subscribe(this.name, listener);
};

/**
 * Unsubscribe listener from topic
 *
 * @method Streaming~Topic#unsubscribe
 * @param {Callback.<Streaming~StreamingMesasge>} listener - Streaming message listener
 * @returns {Streaming~Topic}
 */
Topic.prototype.unsubscribe = function(listener) {
  this._streaming.unsubscribe(this.name, listener);
  return this;
};

/*--------------------------------------------*/

/**
 * Streaming API Generic Streaming Channel
 *
 * @class Streaming~Channel
 * @param {Streaming} steaming - Streaming API object
 * @param {String} name - Channel name (starts with "/u/")
 */
var Channel = function(streaming, name) {
  this._streaming = streaming;
  this._name = name;
};

/**
 * Subscribe to channel
 *
 * @param {Callback.<Streaming~StreamingMessage>} listener - Streaming message listener
 * @returns {Subscription} - Faye subscription object
 */
Channel.prototype.subscribe = function(listener) {
  return this._streaming.subscribe(this._name, listener);
};

Channel.prototype.unsubscribe = function(listener) {
  this._streaming.unsubscribe(this._name, listener);
  return this;
};

Channel.prototype.push = function(events, callback) {
  var isArray = _.isArray(events);
  events = isArray ? events : [ events ];
  var conn = this._streaming._conn;
  if (!this._id) {
    this._id = conn.sobject('StreamingChannel').findOne({ Name: this._name }, 'Id')
      .then(function(rec) { return rec.Id });
  }
  return this._id.then(function(id) {
    var channelUrl = '/sobjects/StreamingChannel/' + id + '/push';
    return conn.requestPost(channelUrl, { pushEvents: events });
  }).then(function(rets) {
    return isArray ? rets : rets[0];
  }).thenCall(callback);
};

/*--------------------------------------------*/

/**
 * Streaming API class
 *
 * @class
 * @extends events.EventEmitter
 * @param {Connection} conn - Connection object
 */
var Streaming = function(conn) {
  this._conn = conn;
};

inherits(Streaming, events.EventEmitter);

/** @private **/
Streaming.prototype._createClient = function(forChannelName, extensions) {
  // forChannelName is advisory, for an API workaround. It does not restrict or select the channel.
  var needsReplayFix = typeof forChannelName === 'string' && forChannelName.indexOf('/u/') === 0;
  var endpointUrl = [
    this._conn.instanceUrl,
    // special endpoint "/cometd/replay/xx.x" is only available in 36.0.
    // See https://releasenotes.docs.salesforce.com/en-us/summer16/release-notes/rn_api_streaming_classic_replay.htm
    "cometd" + (needsReplayFix === true && this._conn.version === "36.0" ? "/replay" : ""),
    this._conn.version
  ].join('/');
  var fayeClient = new Faye.Client(endpointUrl, {
    cookiesAllowAllPaths: true
  });
  fayeClient.setHeader('Authorization', 'OAuth '+this._conn.accessToken);
  if (extensions instanceof Array) {
    extensions.forEach(function(extension) {
      fayeClient.addExtension(extension);
    });
  }
  if (fayeClient._dispatcher.getConnectionTypes().indexOf('callback-polling') === -1) {
    // prevent streaming API server error
    fayeClient._dispatcher.selectTransport('long-polling');
    fayeClient._dispatcher._transport.batching = false;
  }
  return fayeClient;
};

/** @private **/
Streaming.prototype._getFayeClient = function(channelName) {
  var isGeneric = channelName.indexOf('/u/') === 0;
  var clientType = isGeneric ? 'generic' : 'pushTopic';
  if (!this._fayeClients || !this._fayeClients[clientType]) {
    this._fayeClients = this._fayeClients || {};
    this._fayeClients[clientType] = this._createClient(channelName);
  }
  return this._fayeClients[clientType];
};


/**
 * Get named topic
 *
 * @param {String} name - Topic name
 * @returns {Streaming~Topic}
 */
Streaming.prototype.topic = function(name) {
  this._topics = this._topics || {};
  var topic = this._topics[name] =
    this._topics[name] || new Topic(this, name);
  return topic;
};

/**
 * Get Channel for Id
 * @param {String} channelId - Id of StreamingChannel object
 * @returns {Streaming~Channel}
 */
Streaming.prototype.channel = function(channelId) {
  return new Channel(this, channelId);
};

/**
 * Subscribe topic/channel
 *
 * @param {String} name - Topic name
 * @param {Callback.<Streaming~StreamingMessage>} listener - Streaming message listener
 * @returns {Subscription} - Faye subscription object
 */
Streaming.prototype.subscribe = function(name, listener) {
  var channelName = name.indexOf('/') === 0 ? name : '/topic/' + name;
  var fayeClient = this._getFayeClient(channelName);
  return fayeClient.subscribe(channelName, listener);
};

/**
 * Unsubscribe topic
 *
 * @param {String} name - Topic name
 * @param {Callback.<Streaming~StreamingMessage>} listener - Streaming message listener
 * @returns {Streaming}
 */
Streaming.prototype.unsubscribe = function(name, listener) {
  var channelName = name.indexOf('/') === 0 ? name : '/topic/' + name;
  var fayeClient = this._getFayeClient(channelName);
  fayeClient.unsubscribe(channelName, listener);
  return this;
};


/**
 * Create a Streaming client, optionally with extensions
 *
 * See Faye docs for implementation details: https://faye.jcoglan.com/browser/extensions.html
 *
 * Example usage:
 * 
 * ```javascript
 * // Establish a Salesforce connection. (Details elided)
 * const conn = new jsforce.Connection({ … });
 * 
 * const fayeClient = conn.streaming.createClient();
 * 
 * const subscription = fayeClient.subscribe(channel, data => {
 *   console.log('topic received data', data);
 * });
 * 
 * subscription.cancel();
 * ```
 * 
 * Example with extensions, using Replay & Auth Failure extensions in a server-side Node.js app:
 * 
 * ```javascript
 * // Establish a Salesforce connection. (Details elided)
 * const conn = new jsforce.Connection({ … });
 * 
 * const channel = "/event/My_Event__e";
 * const replayId = -2; // -2 is all retained events
 * 
 * const exitCallback = () => process.exit(1);
 * const authFailureExt = new jsforce.StreamingExtension.AuthFailure(exitCallback);
 * 
 * const replayExt = new jsforce.StreamingExtension.Replay(channel, replayId);
 * 
 * const fayeClient = conn.streaming.createClient([
 *   authFailureExt,
 *   replayExt
 * ]);
 * 
 * const subscription = fayeClient.subscribe(channel, data => {
 *   console.log('topic received data', data);
 * });
 * 
 * subscription.cancel();
 * ```
 * 
 * @param {Array} Extensions - Optional, extensions to apply to the Faye client
 * @returns {FayeClient} - Faye client object
 */
Streaming.prototype.createClient = function(extensions) {
  return this._createClient(null, extensions);
};

/*--------------------------------------------*/
/*
 * Register hook in connection instantiation for dynamically adding this API module features
 */
jsforce.on('connection:new', function(conn) {
  conn.streaming = new Streaming(conn);
});

/*
 * 
 */
jsforce.StreamingExtension = StreamingExtension;

module.exports = Streaming;

},{"./streaming-extension":1,"faye":5}],3:[function(require,module,exports){
"use strict";

// rawAsap provides everything we need except exception management.
var rawAsap = require("./raw");
// RawTasks are recycled to reduce GC churn.
var freeTasks = [];
// We queue errors to ensure they are thrown in right order (FIFO).
// Array-as-queue is good enough here, since we are just dealing with exceptions.
var pendingErrors = [];
var requestErrorThrow = rawAsap.makeRequestCallFromTimer(throwFirstError);

function throwFirstError() {
    if (pendingErrors.length) {
        throw pendingErrors.shift();
    }
}

/**
 * Calls a task as soon as possible after returning, in its own event, with priority
 * over other events like animation, reflow, and repaint. An error thrown from an
 * event will not interrupt, nor even substantially slow down the processing of
 * other events, but will be rather postponed to a lower priority event.
 * @param {{call}} task A callable object, typically a function that takes no
 * arguments.
 */
module.exports = asap;
function asap(task) {
    var rawTask;
    if (freeTasks.length) {
        rawTask = freeTasks.pop();
    } else {
        rawTask = new RawTask();
    }
    rawTask.task = task;
    rawAsap(rawTask);
}

// We wrap tasks with recyclable task objects.  A task object implements
// `call`, just like a function.
function RawTask() {
    this.task = null;
}

// The sole purpose of wrapping the task is to catch the exception and recycle
// the task object after its single use.
RawTask.prototype.call = function () {
    try {
        this.task.call();
    } catch (error) {
        if (asap.onerror) {
            // This hook exists purely for testing purposes.
            // Its name will be periodically randomized to break any code that
            // depends on its existence.
            asap.onerror(error);
        } else {
            // In a web browser, exceptions are not fatal. However, to avoid
            // slowing down the queue of pending tasks, we rethrow the error in a
            // lower priority turn.
            pendingErrors.push(error);
            requestErrorThrow();
        }
    } finally {
        this.task = null;
        freeTasks[freeTasks.length] = this;
    }
};

},{"./raw":4}],4:[function(require,module,exports){
(function (global){
"use strict";

// Use the fastest means possible to execute a task in its own turn, with
// priority over other events including IO, animation, reflow, and redraw
// events in browsers.
//
// An exception thrown by a task will permanently interrupt the processing of
// subsequent tasks. The higher level `asap` function ensures that if an
// exception is thrown by a task, that the task queue will continue flushing as
// soon as possible, but if you use `rawAsap` directly, you are responsible to
// either ensure that no exceptions are thrown from your task, or to manually
// call `rawAsap.requestFlush` if an exception is thrown.
module.exports = rawAsap;
function rawAsap(task) {
    if (!queue.length) {
        requestFlush();
        flushing = true;
    }
    // Equivalent to push, but avoids a function call.
    queue[queue.length] = task;
}

var queue = [];
// Once a flush has been requested, no further calls to `requestFlush` are
// necessary until the next `flush` completes.
var flushing = false;
// `requestFlush` is an implementation-specific method that attempts to kick
// off a `flush` event as quickly as possible. `flush` will attempt to exhaust
// the event queue before yielding to the browser's own event loop.
var requestFlush;
// The position of the next task to execute in the task queue. This is
// preserved between calls to `flush` so that it can be resumed if
// a task throws an exception.
var index = 0;
// If a task schedules additional tasks recursively, the task queue can grow
// unbounded. To prevent memory exhaustion, the task queue will periodically
// truncate already-completed tasks.
var capacity = 1024;

// The flush function processes all tasks that have been scheduled with
// `rawAsap` unless and until one of those tasks throws an exception.
// If a task throws an exception, `flush` ensures that its state will remain
// consistent and will resume where it left off when called again.
// However, `flush` does not make any arrangements to be called again if an
// exception is thrown.
function flush() {
    while (index < queue.length) {
        var currentIndex = index;
        // Advance the index before calling the task. This ensures that we will
        // begin flushing on the next task the task throws an error.
        index = index + 1;
        queue[currentIndex].call();
        // Prevent leaking memory for long chains of recursive calls to `asap`.
        // If we call `asap` within tasks scheduled by `asap`, the queue will
        // grow, but to avoid an O(n) walk for every task we execute, we don't
        // shift tasks off the queue after they have been executed.
        // Instead, we periodically shift 1024 tasks off the queue.
        if (index > capacity) {
            // Manually shift all values starting at the index back to the
            // beginning of the queue.
            for (var scan = 0, newLength = queue.length - index; scan < newLength; scan++) {
                queue[scan] = queue[scan + index];
            }
            queue.length -= index;
            index = 0;
        }
    }
    queue.length = 0;
    index = 0;
    flushing = false;
}

// `requestFlush` is implemented using a strategy based on data collected from
// every available SauceLabs Selenium web driver worker at time of writing.
// https://docs.google.com/spreadsheets/d/1mG-5UYGup5qxGdEMWkhP6BWCz053NUb2E1QoUTU16uA/edit#gid=783724593

// Safari 6 and 6.1 for desktop, iPad, and iPhone are the only browsers that
// have WebKitMutationObserver but not un-prefixed MutationObserver.
// Must use `global` or `self` instead of `window` to work in both frames and web
// workers. `global` is a provision of Browserify, Mr, Mrs, or Mop.

/* globals self */
var scope = typeof global !== "undefined" ? global : self;
var BrowserMutationObserver = scope.MutationObserver || scope.WebKitMutationObserver;

// MutationObservers are desirable because they have high priority and work
// reliably everywhere they are implemented.
// They are implemented in all modern browsers.
//
// - Android 4-4.3
// - Chrome 26-34
// - Firefox 14-29
// - Internet Explorer 11
// - iPad Safari 6-7.1
// - iPhone Safari 7-7.1
// - Safari 6-7
if (typeof BrowserMutationObserver === "function") {
    requestFlush = makeRequestCallFromMutationObserver(flush);

// MessageChannels are desirable because they give direct access to the HTML
// task queue, are implemented in Internet Explorer 10, Safari 5.0-1, and Opera
// 11-12, and in web workers in many engines.
// Although message channels yield to any queued rendering and IO tasks, they
// would be better than imposing the 4ms delay of timers.
// However, they do not work reliably in Internet Explorer or Safari.

// Internet Explorer 10 is the only browser that has setImmediate but does
// not have MutationObservers.
// Although setImmediate yields to the browser's renderer, it would be
// preferrable to falling back to setTimeout since it does not have
// the minimum 4ms penalty.
// Unfortunately there appears to be a bug in Internet Explorer 10 Mobile (and
// Desktop to a lesser extent) that renders both setImmediate and
// MessageChannel useless for the purposes of ASAP.
// https://github.com/kriskowal/q/issues/396

// Timers are implemented universally.
// We fall back to timers in workers in most engines, and in foreground
// contexts in the following browsers.
// However, note that even this simple case requires nuances to operate in a
// broad spectrum of browsers.
//
// - Firefox 3-13
// - Internet Explorer 6-9
// - iPad Safari 4.3
// - Lynx 2.8.7
} else {
    requestFlush = makeRequestCallFromTimer(flush);
}

// `requestFlush` requests that the high priority event queue be flushed as
// soon as possible.
// This is useful to prevent an error thrown in a task from stalling the event
// queue if the exception handled by Node.js’s
// `process.on("uncaughtException")` or by a domain.
rawAsap.requestFlush = requestFlush;

// To request a high priority event, we induce a mutation observer by toggling
// the text of a text node between "1" and "-1".
function makeRequestCallFromMutationObserver(callback) {
    var toggle = 1;
    var observer = new BrowserMutationObserver(callback);
    var node = document.createTextNode("");
    observer.observe(node, {characterData: true});
    return function requestCall() {
        toggle = -toggle;
        node.data = toggle;
    };
}

// The message channel technique was discovered by Malte Ubl and was the
// original foundation for this library.
// http://www.nonblocking.io/2011/06/windownexttick.html

// Safari 6.0.5 (at least) intermittently fails to create message ports on a
// page's first load. Thankfully, this version of Safari supports
// MutationObservers, so we don't need to fall back in that case.

// function makeRequestCallFromMessageChannel(callback) {
//     var channel = new MessageChannel();
//     channel.port1.onmessage = callback;
//     return function requestCall() {
//         channel.port2.postMessage(0);
//     };
// }

// For reasons explained above, we are also unable to use `setImmediate`
// under any circumstances.
// Even if we were, there is another bug in Internet Explorer 10.
// It is not sufficient to assign `setImmediate` to `requestFlush` because
// `setImmediate` must be called *by name* and therefore must be wrapped in a
// closure.
// Never forget.

// function makeRequestCallFromSetImmediate(callback) {
//     return function requestCall() {
//         setImmediate(callback);
//     };
// }

// Safari 6.0 has a problem where timers will get lost while the user is
// scrolling. This problem does not impact ASAP because Safari 6.0 supports
// mutation observers, so that implementation is used instead.
// However, if we ever elect to use timers in Safari, the prevalent work-around
// is to add a scroll event listener that calls for a flush.

// `setTimeout` does not call the passed callback if the delay is less than
// approximately 7 in web workers in Firefox 8 through 18, and sometimes not
// even then.

function makeRequestCallFromTimer(callback) {
    return function requestCall() {
        // We dispatch a timeout with a specified delay of 0 for engines that
        // can reliably accommodate that request. This will usually be snapped
        // to a 4 milisecond delay, but once we're flushing, there's no delay
        // between events.
        var timeoutHandle = setTimeout(handleTimer, 0);
        // However, since this timer gets frequently dropped in Firefox
        // workers, we enlist an interval handle that will try to fire
        // an event 20 times per second until it succeeds.
        var intervalHandle = setInterval(handleTimer, 50);

        function handleTimer() {
            // Whichever timer succeeds will cancel both timers and
            // execute the callback.
            clearTimeout(timeoutHandle);
            clearInterval(intervalHandle);
            callback();
        }
    };
}

// This is for `asap.js` only.
// Its name will be periodically randomized to break any code that depends on
// its existence.
rawAsap.makeRequestCallFromTimer = makeRequestCallFromTimer;

// ASAP was originally a nextTick shim included in Q. This was factored out
// into this ASAP package. It was later adapted to RSVP which made further
// amendments. These decisions, particularly to marginalize MessageChannel and
// to capture the MutationObserver implementation in a closure, were integrated
// back into ASAP proper.
// https://github.com/tildeio/rsvp.js/blob/cddf7232546a9cf858524b75cde6f9edf72620a7/lib/rsvp/asap.js

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],5:[function(require,module,exports){
'use strict';

var constants = require('./util/constants'),
    Logging   = require('./mixins/logging');

var Faye = {
  VERSION:    constants.VERSION,

  Client:     require('./protocol/client'),
  Scheduler:  require('./protocol/scheduler')
};

Logging.wrapper = Faye;

module.exports = Faye;

},{"./mixins/logging":7,"./protocol/client":11,"./protocol/scheduler":17,"./util/constants":29}],6:[function(require,module,exports){
(function (global){
'use strict';

var Promise   = require('../util/promise');

module.exports = {
  then: function(callback, errback) {
    var self = this;
    if (!this._promise)
      this._promise = new Promise(function(resolve, reject) {
        self._resolve = resolve;
        self._reject  = reject;
      });

    if (arguments.length === 0)
      return this._promise;
    else
      return this._promise.then(callback, errback);
  },

  callback: function(callback, context) {
    return this.then(function(value) { callback.call(context, value) });
  },

  errback: function(callback, context) {
    return this.then(null, function(reason) { callback.call(context, reason) });
  },

  timeout: function(seconds, message) {
    this.then();
    var self = this;
    this._timer = global.setTimeout(function() {
      self._reject(message);
    }, seconds * 1000);
  },

  setDeferredStatus: function(status, value) {
    if (this._timer) global.clearTimeout(this._timer);

    this.then();

    if (status === 'succeeded')
      this._resolve(value);
    else if (status === 'failed')
      this._reject(value);
    else
      delete this._promise;
  }
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../util/promise":34}],7:[function(require,module,exports){
'use strict';

var toJSON = require('../util/to_json');

var Logging = {
  LOG_LEVELS: {
    fatal:  4,
    error:  3,
    warn:   2,
    info:   1,
    debug:  0
  },

  writeLog: function(messageArgs, level) {
    var logger = Logging.logger || (Logging.wrapper || Logging).logger;
    if (!logger) return;

    var args   = Array.prototype.slice.apply(messageArgs),
        banner = '[Faye',
        klass  = this.className,

        message = args.shift().replace(/\?/g, function() {
          try {
            return toJSON(args.shift());
          } catch (error) {
            return '[Object]';
          }
        });

    if (klass) banner += '.' + klass;
    banner += '] ';

    if (typeof logger[level] === 'function')
      logger[level](banner + message);
    else if (typeof logger === 'function')
      logger(banner + message);
  }
};

for (var key in Logging.LOG_LEVELS)
  (function(level) {
    Logging[level] = function() {
      this.writeLog(arguments, level);
    };
  })(key);

module.exports = Logging;

},{"../util/to_json":36}],8:[function(require,module,exports){
'use strict';

var extend       = require('../util/extend'),
    EventEmitter = require('../util/event_emitter');

var Publisher = {
  countListeners: function(eventType) {
    return this.listeners(eventType).length;
  },

  bind: function(eventType, listener, context) {
    var slice   = Array.prototype.slice,
        handler = function() { listener.apply(context, slice.call(arguments)) };

    this._listeners = this._listeners || [];
    this._listeners.push([eventType, listener, context, handler]);
    return this.on(eventType, handler);
  },

  unbind: function(eventType, listener, context) {
    this._listeners = this._listeners || [];
    var n = this._listeners.length, tuple;

    while (n--) {
      tuple = this._listeners[n];
      if (tuple[0] !== eventType) continue;
      if (listener && (tuple[1] !== listener || tuple[2] !== context)) continue;
      this._listeners.splice(n, 1);
      this.removeListener(eventType, tuple[3]);
    }
  }
};

extend(Publisher, EventEmitter.prototype);
Publisher.trigger = Publisher.emit;

module.exports = Publisher;

},{"../util/event_emitter":32,"../util/extend":33}],9:[function(require,module,exports){
(function (global){
'use strict';

module.exports = {
  addTimeout: function(name, delay, callback, context) {
    this._timeouts = this._timeouts || {};
    if (this._timeouts.hasOwnProperty(name)) return;
    var self = this;
    this._timeouts[name] = global.setTimeout(function() {
      delete self._timeouts[name];
      callback.call(context);
    }, 1000 * delay);
  },

  removeTimeout: function(name) {
    this._timeouts = this._timeouts || {};
    var timeout = this._timeouts[name];
    if (!timeout) return;
    global.clearTimeout(timeout);
    delete this._timeouts[name];
  },

  removeAllTimeouts: function() {
    this._timeouts = this._timeouts || {};
    for (var name in this._timeouts) this.removeTimeout(name);
  }
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],10:[function(require,module,exports){
'use strict';

var Class     = require('../util/class'),
    extend    = require('../util/extend'),
    Publisher = require('../mixins/publisher'),
    Grammar   = require('./grammar');

var Channel = Class({
  initialize: function(name) {
    this.id = this.name = name;
  },

  push: function(message) {
    this.trigger('message', message);
  },

  isUnused: function() {
    return this.countListeners('message') === 0;
  }
});

extend(Channel.prototype, Publisher);

extend(Channel, {
  HANDSHAKE:    '/meta/handshake',
  CONNECT:      '/meta/connect',
  SUBSCRIBE:    '/meta/subscribe',
  UNSUBSCRIBE:  '/meta/unsubscribe',
  DISCONNECT:   '/meta/disconnect',

  META:         'meta',
  SERVICE:      'service',

  expand: function(name) {
    var segments = this.parse(name),
        channels = ['/**', name];

    var copy = segments.slice();
    copy[copy.length - 1] = '*';
    channels.push(this.unparse(copy));

    for (var i = 1, n = segments.length; i < n; i++) {
      copy = segments.slice(0, i);
      copy.push('**');
      channels.push(this.unparse(copy));
    }

    return channels;
  },

  isValid: function(name) {
    return Grammar.CHANNEL_NAME.test(name) ||
           Grammar.CHANNEL_PATTERN.test(name);
  },

  parse: function(name) {
    if (!this.isValid(name)) return null;
    return name.split('/').slice(1);
  },

  unparse: function(segments) {
    return '/' + segments.join('/');
  },

  isMeta: function(name) {
    var segments = this.parse(name);
    return segments ? (segments[0] === this.META) : null;
  },

  isService: function(name) {
    var segments = this.parse(name);
    return segments ? (segments[0] === this.SERVICE) : null;
  },

  isSubscribable: function(name) {
    if (!this.isValid(name)) return null;
    return !this.isMeta(name) && !this.isService(name);
  },

  Set: Class({
    initialize: function() {
      this._channels = {};
    },

    getKeys: function() {
      var keys = [];
      for (var key in this._channels) keys.push(key);
      return keys;
    },

    remove: function(name) {
      delete this._channels[name];
    },

    hasSubscription: function(name) {
      return this._channels.hasOwnProperty(name);
    },

    subscribe: function(names, subscription) {
      var name;
      for (var i = 0, n = names.length; i < n; i++) {
        name = names[i];
        var channel = this._channels[name] = this._channels[name] || new Channel(name);
        channel.bind('message', subscription);
      }
    },

    unsubscribe: function(name, subscription) {
      var channel = this._channels[name];
      if (!channel) return false;
      channel.unbind('message', subscription);

      if (channel.isUnused()) {
        this.remove(name);
        return true;
      } else {
        return false;
      }
    },

    distributeMessage: function(message) {
      var channels = Channel.expand(message.channel);

      for (var i = 0, n = channels.length; i < n; i++) {
        var channel = this._channels[channels[i]];
        if (channel) channel.trigger('message', message);
      }
    }
  })
});

module.exports = Channel;

},{"../mixins/publisher":8,"../util/class":28,"../util/extend":33,"./grammar":15}],11:[function(require,module,exports){
(function (global){
'use strict';

var asap            = require('asap'),
    Class           = require('../util/class'),
    Promise         = require('../util/promise'),
    URI             = require('../util/uri'),
    array           = require('../util/array'),
    browser         = require('../util/browser'),
    constants       = require('../util/constants'),
    extend          = require('../util/extend'),
    validateOptions = require('../util/validate_options'),
    Deferrable      = require('../mixins/deferrable'),
    Logging         = require('../mixins/logging'),
    Publisher       = require('../mixins/publisher'),
    Channel         = require('./channel'),
    Dispatcher      = require('./dispatcher'),
    Error           = require('./error'),
    Extensible      = require('./extensible'),
    Publication     = require('./publication'),
    Subscription    = require('./subscription');

var Client = Class({ className: 'Client',
  UNCONNECTED:        1,
  CONNECTING:         2,
  CONNECTED:          3,
  DISCONNECTED:       4,

  HANDSHAKE:          'handshake',
  RETRY:              'retry',
  NONE:               'none',

  CONNECTION_TIMEOUT: 60,

  DEFAULT_ENDPOINT:   '/bayeux',
  INTERVAL:           0,

  initialize: function(endpoint, options) {
    this.info('New client created for ?', endpoint);
    options = options || {};

    validateOptions(options, ['interval', 'timeout', 'endpoints', 'proxy', 'retry', 'scheduler', 'websocketExtensions', 'tls', 'ca']);

    this._channels   = new Channel.Set();
    this._dispatcher = Dispatcher.create(this, endpoint || this.DEFAULT_ENDPOINT, options);

    this._messageId = 0;
    this._state     = this.UNCONNECTED;

    this._responseCallbacks = {};

    this._advice = {
      reconnect: this.RETRY,
      interval:  1000 * (options.interval || this.INTERVAL),
      timeout:   1000 * (options.timeout  || this.CONNECTION_TIMEOUT)
    };
    this._dispatcher.timeout = this._advice.timeout / 1000;

    this._dispatcher.bind('message', this._receiveMessage, this);

    if (browser.Event && global.onbeforeunload !== undefined)
      browser.Event.on(global, 'beforeunload', function() {
        if (array.indexOf(this._dispatcher._disabled, 'autodisconnect') < 0)
          this.disconnect();
      }, this);
  },

  addWebsocketExtension: function(extension) {
    return this._dispatcher.addWebsocketExtension(extension);
  },

  disable: function(feature) {
    return this._dispatcher.disable(feature);
  },

  setHeader: function(name, value) {
    return this._dispatcher.setHeader(name, value);
  },

  // Request
  // MUST include:  * channel
  //                * version
  //                * supportedConnectionTypes
  // MAY include:   * minimumVersion
  //                * ext
  //                * id
  //
  // Success Response                             Failed Response
  // MUST include:  * channel                     MUST include:  * channel
  //                * version                                    * successful
  //                * supportedConnectionTypes                   * error
  //                * clientId                    MAY include:   * supportedConnectionTypes
  //                * successful                                 * advice
  // MAY include:   * minimumVersion                             * version
  //                * advice                                     * minimumVersion
  //                * ext                                        * ext
  //                * id                                         * id
  //                * authSuccessful
  handshake: function(callback, context) {
    if (this._advice.reconnect === this.NONE) return;
    if (this._state !== this.UNCONNECTED) return;

    this._state = this.CONNECTING;
    var self = this;

    this.info('Initiating handshake with ?', URI.stringify(this._dispatcher.endpoint));
    this._dispatcher.selectTransport(constants.MANDATORY_CONNECTION_TYPES);

    this._sendMessage({
      channel:                  Channel.HANDSHAKE,
      version:                  constants.BAYEUX_VERSION,
      supportedConnectionTypes: this._dispatcher.getConnectionTypes()

    }, {}, function(response) {

      if (response.successful) {
        this._state = this.CONNECTED;
        this._dispatcher.clientId  = response.clientId;

        this._dispatcher.selectTransport(response.supportedConnectionTypes);

        this.info('Handshake successful: ?', this._dispatcher.clientId);

        this.subscribe(this._channels.getKeys(), true);
        if (callback) asap(function() { callback.call(context) });

      } else {
        this.info('Handshake unsuccessful');
        global.setTimeout(function() { self.handshake(callback, context) }, this._dispatcher.retry * 1000);
        this._state = this.UNCONNECTED;
      }
    }, this);
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  //                * connectionType                     * clientId
  // MAY include:   * ext                 MAY include:   * error
  //                * id                                 * advice
  //                                                     * ext
  //                                                     * id
  //                                                     * timestamp
  connect: function(callback, context) {
    if (this._advice.reconnect === this.NONE) return;
    if (this._state === this.DISCONNECTED) return;

    if (this._state === this.UNCONNECTED)
      return this.handshake(function() { this.connect(callback, context) }, this);

    this.callback(callback, context);
    if (this._state !== this.CONNECTED) return;

    this.info('Calling deferred actions for ?', this._dispatcher.clientId);
    this.setDeferredStatus('succeeded');
    this.setDeferredStatus('unknown');

    if (this._connectRequest) return;
    this._connectRequest = true;

    this.info('Initiating connection for ?', this._dispatcher.clientId);

    this._sendMessage({
      channel:        Channel.CONNECT,
      clientId:       this._dispatcher.clientId,
      connectionType: this._dispatcher.connectionType

    }, {}, this._cycleConnection, this);
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  // MAY include:   * ext                                * clientId
  //                * id                  MAY include:   * error
  //                                                     * ext
  //                                                     * id
  disconnect: function() {
    if (this._state !== this.CONNECTED) return;
    this._state = this.DISCONNECTED;

    this.info('Disconnecting ?', this._dispatcher.clientId);
    var promise = new Publication();

    this._sendMessage({
      channel:  Channel.DISCONNECT,
      clientId: this._dispatcher.clientId

    }, {}, function(response) {
      if (response.successful) {
        this._dispatcher.close();
        promise.setDeferredStatus('succeeded');
      } else {
        promise.setDeferredStatus('failed', Error.parse(response.error));
      }
    }, this);

    this.info('Clearing channel listeners for ?', this._dispatcher.clientId);
    this._channels = new Channel.Set();

    return promise;
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  //                * subscription                       * clientId
  // MAY include:   * ext                                * subscription
  //                * id                  MAY include:   * error
  //                                                     * advice
  //                                                     * ext
  //                                                     * id
  //                                                     * timestamp
  subscribe: function(channel, callback, context) {
    if (channel instanceof Array)
      return array.map(channel, function(c) {
        return this.subscribe(c, callback, context);
      }, this);

    var subscription = new Subscription(this, channel, callback, context),
        force        = (callback === true),
        hasSubscribe = this._channels.hasSubscription(channel);

    if (hasSubscribe && !force) {
      this._channels.subscribe([channel], subscription);
      subscription.setDeferredStatus('succeeded');
      return subscription;
    }

    this.connect(function() {
      this.info('Client ? attempting to subscribe to ?', this._dispatcher.clientId, channel);
      if (!force) this._channels.subscribe([channel], subscription);

      this._sendMessage({
        channel:      Channel.SUBSCRIBE,
        clientId:     this._dispatcher.clientId,
        subscription: channel

      }, {}, function(response) {
        if (!response.successful) {
          subscription.setDeferredStatus('failed', Error.parse(response.error));
          return this._channels.unsubscribe(channel, subscription);
        }

        var channels = [].concat(response.subscription);
        this.info('Subscription acknowledged for ? to ?', this._dispatcher.clientId, channels);
        subscription.setDeferredStatus('succeeded');
      }, this);
    }, this);

    return subscription;
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * clientId                           * successful
  //                * subscription                       * clientId
  // MAY include:   * ext                                * subscription
  //                * id                  MAY include:   * error
  //                                                     * advice
  //                                                     * ext
  //                                                     * id
  //                                                     * timestamp
  unsubscribe: function(channel, subscription) {
    if (channel instanceof Array)
      return array.map(channel, function(c) {
        return this.unsubscribe(c, subscription);
      }, this);

    var dead = this._channels.unsubscribe(channel, subscription);
    if (!dead) return;

    this.connect(function() {
      this.info('Client ? attempting to unsubscribe from ?', this._dispatcher.clientId, channel);

      this._sendMessage({
        channel:      Channel.UNSUBSCRIBE,
        clientId:     this._dispatcher.clientId,
        subscription: channel

      }, {}, function(response) {
        if (!response.successful) return;

        var channels = [].concat(response.subscription);
        this.info('Unsubscription acknowledged for ? from ?', this._dispatcher.clientId, channels);
      }, this);
    }, this);
  },

  // Request                              Response
  // MUST include:  * channel             MUST include:  * channel
  //                * data                               * successful
  // MAY include:   * clientId            MAY include:   * id
  //                * id                                 * error
  //                * ext                                * ext
  publish: function(channel, data, options) {
    validateOptions(options || {}, ['attempts', 'deadline']);
    var publication = new Publication();

    this.connect(function() {
      this.info('Client ? queueing published message to ?: ?', this._dispatcher.clientId, channel, data);

      this._sendMessage({
        channel:  channel,
        data:     data,
        clientId: this._dispatcher.clientId

      }, options, function(response) {
        if (response.successful)
          publication.setDeferredStatus('succeeded');
        else
          publication.setDeferredStatus('failed', Error.parse(response.error));
      }, this);
    }, this);

    return publication;
  },

  _sendMessage: function(message, options, callback, context) {
    message.id = this._generateMessageId();

    var timeout = this._advice.timeout
                ? 1.2 * this._advice.timeout / 1000
                : 1.2 * this._dispatcher.retry;

    this.pipeThroughExtensions('outgoing', message, null, function(message) {
      if (!message) return;
      if (callback) this._responseCallbacks[message.id] = [callback, context];
      this._dispatcher.sendMessage(message, timeout, options || {});
    }, this);
  },

  _generateMessageId: function() {
    this._messageId += 1;
    if (this._messageId >= Math.pow(2,32)) this._messageId = 0;
    return this._messageId.toString(36);
  },

  _receiveMessage: function(message) {
    var id = message.id, callback;

    if (message.successful !== undefined) {
      callback = this._responseCallbacks[id];
      delete this._responseCallbacks[id];
    }

    this.pipeThroughExtensions('incoming', message, null, function(message) {
      if (!message) return;
      if (message.advice) this._handleAdvice(message.advice);
      this._deliverMessage(message);
      if (callback) callback[0].call(callback[1], message);
    }, this);
  },

  _handleAdvice: function(advice) {
    extend(this._advice, advice);
    this._dispatcher.timeout = this._advice.timeout / 1000;

    if (this._advice.reconnect === this.HANDSHAKE && this._state !== this.DISCONNECTED) {
      this._state = this.UNCONNECTED;
      this._dispatcher.clientId = null;
      this._cycleConnection();
    }
  },

  _deliverMessage: function(message) {
    if (!message.channel || message.data === undefined) return;
    this.info('Client ? calling listeners for ? with ?', this._dispatcher.clientId, message.channel, message.data);
    this._channels.distributeMessage(message);
  },

  _cycleConnection: function() {
    if (this._connectRequest) {
      this._connectRequest = null;
      this.info('Closed connection for ?', this._dispatcher.clientId);
    }
    var self = this;
    global.setTimeout(function() { self.connect() }, this._advice.interval);
  }
});

extend(Client.prototype, Deferrable);
extend(Client.prototype, Publisher);
extend(Client.prototype, Logging);
extend(Client.prototype, Extensible);

module.exports = Client;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../mixins/deferrable":6,"../mixins/logging":7,"../mixins/publisher":8,"../util/array":26,"../util/browser":27,"../util/class":28,"../util/constants":29,"../util/extend":33,"../util/promise":34,"../util/uri":37,"../util/validate_options":38,"./channel":10,"./dispatcher":12,"./error":13,"./extensible":14,"./publication":16,"./subscription":18,"asap":3}],12:[function(require,module,exports){
(function (global){
'use strict';

var Class     = require('../util/class'),
    URI       = require('../util/uri'),
    cookies   = require('../util/cookies'),
    extend    = require('../util/extend'),
    Logging   = require('../mixins/logging'),
    Publisher = require('../mixins/publisher'),
    Transport = require('../transport'),
    Scheduler = require('./scheduler');

var Dispatcher = Class({ className: 'Dispatcher',
  MAX_REQUEST_SIZE: 2048,
  DEFAULT_RETRY:    5,

  UP:   1,
  DOWN: 2,

  initialize: function(client, endpoint, options) {
    this._client     = client;
    this.endpoint    = URI.parse(endpoint);
    this._alternates = options.endpoints || {};

    this.cookies      = cookies.CookieJar && new cookies.CookieJar();
    this._disabled    = [];
    this._envelopes   = {};
    this.headers      = {};
    this.retry        = options.retry || this.DEFAULT_RETRY;
    this._scheduler   = options.scheduler || Scheduler;
    this._state       = 0;
    this.transports   = {};
    this.wsExtensions = [];

    this.proxy = options.proxy || {};
    if (typeof this._proxy === 'string') this._proxy = {origin: this._proxy};

    var exts = options.websocketExtensions;
    if (exts) {
      exts = [].concat(exts);
      for (var i = 0, n = exts.length; i < n; i++)
        this.addWebsocketExtension(exts[i]);
    }

    this.tls = options.tls || {};
    this.tls.ca = this.tls.ca || options.ca;

    for (var type in this._alternates)
      this._alternates[type] = URI.parse(this._alternates[type]);

    this.maxRequestSize = this.MAX_REQUEST_SIZE;
  },

  endpointFor: function(connectionType) {
    return this._alternates[connectionType] || this.endpoint;
  },

  addWebsocketExtension: function(extension) {
    this.wsExtensions.push(extension);
  },

  disable: function(feature) {
    this._disabled.push(feature);
  },

  setHeader: function(name, value) {
    this.headers[name] = value;
  },

  close: function() {
    var transport = this._transport;
    delete this._transport;
    if (transport) transport.close();
  },

  getConnectionTypes: function() {
    return Transport.getConnectionTypes();
  },

  selectTransport: function(transportTypes) {
    Transport.get(this, transportTypes, this._disabled, function(transport) {
      this.debug('Selected ? transport for ?', transport.connectionType, URI.stringify(transport.endpoint));

      if (transport === this._transport) return;
      if (this._transport) this._transport.close();

      this._transport = transport;
      this.connectionType = transport.connectionType;
    }, this);
  },

  sendMessage: function(message, timeout, options) {
    options = options || {};

    var id       = message.id,
        attempts = options.attempts,
        deadline = options.deadline && new Date().getTime() + (options.deadline * 1000),
        envelope = this._envelopes[id],
        scheduler;

    if (!envelope) {
      scheduler = new this._scheduler(message, {timeout: timeout, interval: this.retry, attempts: attempts, deadline: deadline});
      envelope  = this._envelopes[id] = {message: message, scheduler: scheduler};
    }

    this._sendEnvelope(envelope);
  },

  _sendEnvelope: function(envelope) {
    if (!this._transport) return;
    if (envelope.request || envelope.timer) return;

    var message   = envelope.message,
        scheduler = envelope.scheduler,
        self      = this;

    if (!scheduler.isDeliverable()) {
      scheduler.abort();
      delete this._envelopes[message.id];
      return;
    }

    envelope.timer = global.setTimeout(function() {
      self.handleError(message);
    }, scheduler.getTimeout() * 1000);

    scheduler.send();
    envelope.request = this._transport.sendMessage(message);
  },

  handleResponse: function(reply) {
    var envelope = this._envelopes[reply.id];

    if (reply.successful !== undefined && envelope) {
      envelope.scheduler.succeed();
      delete this._envelopes[reply.id];
      global.clearTimeout(envelope.timer);
    }

    this.trigger('message', reply);

    if (this._state === this.UP) return;
    this._state = this.UP;
    this._client.trigger('transport:up');
  },

  handleError: function(message, immediate) {
    var envelope = this._envelopes[message.id],
        request  = envelope && envelope.request,
        self     = this;

    if (!request) return;

    request.then(function(req) {
      if (req && req.abort) req.abort();
    });

    var scheduler = envelope.scheduler;
    scheduler.fail();

    global.clearTimeout(envelope.timer);
    envelope.request = envelope.timer = null;

    if (immediate) {
      this._sendEnvelope(envelope);
    } else {
      envelope.timer = global.setTimeout(function() {
        envelope.timer = null;
        self._sendEnvelope(envelope);
      }, scheduler.getInterval() * 1000);
    }

    if (this._state === this.DOWN) return;
    this._state = this.DOWN;
    this._client.trigger('transport:down');
  }
});

Dispatcher.create = function(client, endpoint, options) {
  return new Dispatcher(client, endpoint, options);
};

extend(Dispatcher.prototype, Publisher);
extend(Dispatcher.prototype, Logging);

module.exports = Dispatcher;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../mixins/logging":7,"../mixins/publisher":8,"../transport":19,"../util/class":28,"../util/cookies":30,"../util/extend":33,"../util/uri":37,"./scheduler":17}],13:[function(require,module,exports){
'use strict';

var Class   = require('../util/class'),
    Grammar = require('./grammar');

var Error = Class({
  initialize: function(code, params, message) {
    this.code    = code;
    this.params  = Array.prototype.slice.call(params);
    this.message = message;
  },

  toString: function() {
    return this.code + ':' +
           this.params.join(',') + ':' +
           this.message;
  }
});

Error.parse = function(message) {
  message = message || '';
  if (!Grammar.ERROR.test(message)) return new Error(null, [], message);

  var parts   = message.split(':'),
      code    = parseInt(parts[0]),
      params  = parts[1].split(','),
      message = parts[2];

  return new Error(code, params, message);
};

// http://code.google.com/p/cometd/wiki/BayeuxCodes
var errors = {
  versionMismatch:  [300, 'Version mismatch'],
  conntypeMismatch: [301, 'Connection types not supported'],
  extMismatch:      [302, 'Extension mismatch'],
  badRequest:       [400, 'Bad request'],
  clientUnknown:    [401, 'Unknown client'],
  parameterMissing: [402, 'Missing required parameter'],
  channelForbidden: [403, 'Forbidden channel'],
  channelUnknown:   [404, 'Unknown channel'],
  channelInvalid:   [405, 'Invalid channel'],
  extUnknown:       [406, 'Unknown extension'],
  publishFailed:    [407, 'Failed to publish'],
  serverError:      [500, 'Internal server error']
};

for (var name in errors)
  (function(name) {
    Error[name] = function() {
      return new Error(errors[name][0], arguments, errors[name][1]).toString();
    };
  })(name);

module.exports = Error;

},{"../util/class":28,"./grammar":15}],14:[function(require,module,exports){
'use strict';

var extend  = require('../util/extend'),
    Logging = require('../mixins/logging');

var Extensible = {
  addExtension: function(extension) {
    this._extensions = this._extensions || [];
    this._extensions.push(extension);
    if (extension.added) extension.added(this);
  },

  removeExtension: function(extension) {
    if (!this._extensions) return;
    var i = this._extensions.length;
    while (i--) {
      if (this._extensions[i] !== extension) continue;
      this._extensions.splice(i,1);
      if (extension.removed) extension.removed(this);
    }
  },

  pipeThroughExtensions: function(stage, message, request, callback, context) {
    this.debug('Passing through ? extensions: ?', stage, message);

    if (!this._extensions) return callback.call(context, message);
    var extensions = this._extensions.slice();

    var pipe = function(message) {
      if (!message) return callback.call(context, message);

      var extension = extensions.shift();
      if (!extension) return callback.call(context, message);

      var fn = extension[stage];
      if (!fn) return pipe(message);

      if (fn.length >= 3) extension[stage](message, request, pipe);
      else                extension[stage](message, pipe);
    };
    pipe(message);
  }
};

extend(Extensible, Logging);

module.exports = Extensible;

},{"../mixins/logging":7,"../util/extend":33}],15:[function(require,module,exports){
'use strict';

module.exports = {
  CHANNEL_NAME:     /^\/(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)))+(\/(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)))+)*$/,
  CHANNEL_PATTERN:  /^(\/(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)))+)*\/\*{1,2}$/,
  ERROR:            /^([0-9][0-9][0-9]:(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)| |\/|\*|\.))*(,(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)| |\/|\*|\.))*)*:(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)| |\/|\*|\.))*|[0-9][0-9][0-9]::(((([a-z]|[A-Z])|[0-9])|(\-|\_|\!|\~|\(|\)|\$|\@)| |\/|\*|\.))*)$/,
  VERSION:          /^([0-9])+(\.(([a-z]|[A-Z])|[0-9])(((([a-z]|[A-Z])|[0-9])|\-|\_))*)*$/
};

},{}],16:[function(require,module,exports){
'use strict';

var Class      = require('../util/class'),
    Deferrable = require('../mixins/deferrable');

module.exports = Class(Deferrable);

},{"../mixins/deferrable":6,"../util/class":28}],17:[function(require,module,exports){
'use strict';

var extend = require('../util/extend');

var Scheduler = function(message, options) {
  this.message  = message;
  this.options  = options;
  this.attempts = 0;
};

extend(Scheduler.prototype, {
  getTimeout: function() {
    return this.options.timeout;
  },

  getInterval: function() {
    return this.options.interval;
  },

  isDeliverable: function() {
    var attempts = this.options.attempts,
        made     = this.attempts,
        deadline = this.options.deadline,
        now      = new Date().getTime();

    if (attempts !== undefined && made >= attempts)
      return false;

    if (deadline !== undefined && now > deadline)
      return false;

    return true;
  },

  send: function() {
    this.attempts += 1;
  },

  succeed: function() {},

  fail: function() {},

  abort: function() {}
});

module.exports = Scheduler;

},{"../util/extend":33}],18:[function(require,module,exports){
'use strict';

var Class      = require('../util/class'),
    extend     = require('../util/extend'),
    Deferrable = require('../mixins/deferrable');

var Subscription = Class({
  initialize: function(client, channels, callback, context) {
    this._client    = client;
    this._channels  = channels;
    this._callback  = callback;
    this._context   = context;
    this._cancelled = false;
  },

  withChannel: function(callback, context) {
    this._withChannel = [callback, context];
    return this;
  },

  apply: function(context, args) {
    var message = args[0];

    if (this._callback)
      this._callback.call(this._context, message.data);

    if (this._withChannel)
      this._withChannel[0].call(this._withChannel[1], message.channel, message.data);
  },

  cancel: function() {
    if (this._cancelled) return;
    this._client.unsubscribe(this._channels, this);
    this._cancelled = true;
  },

  unsubscribe: function() {
    this.cancel();
  }
});

extend(Subscription.prototype, Deferrable);

module.exports = Subscription;

},{"../mixins/deferrable":6,"../util/class":28,"../util/extend":33}],19:[function(require,module,exports){
'use strict';

var Transport = require('./transport');

Transport.register('websocket', require('./web_socket'));
Transport.register('eventsource', require('./event_source'));
Transport.register('long-polling', require('./xhr'));
Transport.register('cross-origin-long-polling', require('./cors'));
Transport.register('callback-polling', require('./jsonp'));

module.exports = Transport;

},{"./cors":20,"./event_source":21,"./jsonp":22,"./transport":23,"./web_socket":24,"./xhr":25}],20:[function(require,module,exports){
(function (global){
'use strict';

var Class     = require('../util/class'),
    Set       = require('../util/set'),
    URI       = require('../util/uri'),
    extend    = require('../util/extend'),
    toJSON    = require('../util/to_json'),
    Transport = require('./transport');

var CORS = extend(Class(Transport, {
  encode: function(messages) {
    return 'message=' + encodeURIComponent(toJSON(messages));
  },

  request: function(messages) {
    var xhrClass = global.XDomainRequest ? XDomainRequest : XMLHttpRequest,
        xhr      = new xhrClass(),
        id       = ++CORS._id,
        headers  = this._dispatcher.headers,
        self     = this,
        key;

    xhr.open('POST', URI.stringify(this.endpoint), true);

    if (xhr.setRequestHeader) {
      xhr.setRequestHeader('Pragma', 'no-cache');
      for (key in headers) {
        if (!headers.hasOwnProperty(key)) continue;
        xhr.setRequestHeader(key, headers[key]);
      }
    }

    var cleanUp = function() {
      if (!xhr) return false;
      CORS._pending.remove(id);
      xhr.onload = xhr.onerror = xhr.ontimeout = xhr.onprogress = null;
      xhr = null;
    };

    xhr.onload = function() {
      var replies;
      try { replies = JSON.parse(xhr.responseText) } catch (error) {}

      cleanUp();

      if (replies)
        self._receive(replies);
      else
        self._handleError(messages);
    };

    xhr.onerror = xhr.ontimeout = function() {
      cleanUp();
      self._handleError(messages);
    };

    xhr.onprogress = function() {};

    if (xhrClass === global.XDomainRequest)
      CORS._pending.add({id: id, xhr: xhr});

    xhr.send(this.encode(messages));
    return xhr;
  }
}), {
  _id:      0,
  _pending: new Set(),

  isUsable: function(dispatcher, endpoint, callback, context) {
    if (URI.isSameOrigin(endpoint))
      return callback.call(context, false);

    if (global.XDomainRequest)
      return callback.call(context, endpoint.protocol === location.protocol);

    if (global.XMLHttpRequest) {
      var xhr = new XMLHttpRequest();
      return callback.call(context, xhr.withCredentials !== undefined);
    }
    return callback.call(context, false);
  }
});

module.exports = CORS;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../util/class":28,"../util/extend":33,"../util/set":35,"../util/to_json":36,"../util/uri":37,"./transport":23}],21:[function(require,module,exports){
(function (global){
'use strict';

var Class      = require('../util/class'),
    URI        = require('../util/uri'),
    copyObject = require('../util/copy_object'),
    extend     = require('../util/extend'),
    Deferrable = require('../mixins/deferrable'),
    Transport  = require('./transport'),
    XHR        = require('./xhr');

var EventSource = extend(Class(Transport, {
  initialize: function(dispatcher, endpoint) {
    Transport.prototype.initialize.call(this, dispatcher, endpoint);
    if (!global.EventSource) return this.setDeferredStatus('failed');

    this._xhr = new XHR(dispatcher, endpoint);

    endpoint = copyObject(endpoint);
    endpoint.pathname += '/' + dispatcher.clientId;

    var socket = new global.EventSource(URI.stringify(endpoint)),
        self   = this;

    socket.onopen = function() {
      self._everConnected = true;
      self.setDeferredStatus('succeeded');
    };

    socket.onerror = function() {
      if (self._everConnected) {
        self._handleError([]);
      } else {
        self.setDeferredStatus('failed');
        socket.close();
      }
    };

    socket.onmessage = function(event) {
      var replies;
      try { replies = JSON.parse(event.data) } catch (error) {}

      if (replies)
        self._receive(replies);
      else
        self._handleError([]);
    };

    this._socket = socket;
  },

  close: function() {
    if (!this._socket) return;
    this._socket.onopen = this._socket.onerror = this._socket.onmessage = null;
    this._socket.close();
    delete this._socket;
  },

  isUsable: function(callback, context) {
    this.callback(function() { callback.call(context, true) });
    this.errback(function() { callback.call(context, false) });
  },

  encode: function(messages) {
    return this._xhr.encode(messages);
  },

  request: function(messages) {
    return this._xhr.request(messages);
  }

}), {
  isUsable: function(dispatcher, endpoint, callback, context) {
    var id = dispatcher.clientId;
    if (!id) return callback.call(context, false);

    XHR.isUsable(dispatcher, endpoint, function(usable) {
      if (!usable) return callback.call(context, false);
      this.create(dispatcher, endpoint).isUsable(callback, context);
    }, this);
  },

  create: function(dispatcher, endpoint) {
    var sockets = dispatcher.transports.eventsource = dispatcher.transports.eventsource || {},
        id      = dispatcher.clientId;

    var url = copyObject(endpoint);
    url.pathname += '/' + (id || '');
    url = URI.stringify(url);

    sockets[url] = sockets[url] || new this(dispatcher, endpoint);
    return sockets[url];
  }
});

extend(EventSource.prototype, Deferrable);

module.exports = EventSource;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../mixins/deferrable":6,"../util/class":28,"../util/copy_object":31,"../util/extend":33,"../util/uri":37,"./transport":23,"./xhr":25}],22:[function(require,module,exports){
(function (global){
'use strict';

var Class      = require('../util/class'),
    URI        = require('../util/uri'),
    copyObject = require('../util/copy_object'),
    extend     = require('../util/extend'),
    toJSON     = require('../util/to_json'),
    Transport  = require('./transport');

var JSONP = extend(Class(Transport, {
 encode: function(messages) {
    var url = copyObject(this.endpoint);
    url.query.message = toJSON(messages);
    url.query.jsonp   = '__jsonp' + JSONP._cbCount + '__';
    return URI.stringify(url);
  },

  request: function(messages) {
    var head         = document.getElementsByTagName('head')[0],
        script       = document.createElement('script'),
        callbackName = JSONP.getCallbackName(),
        endpoint     = copyObject(this.endpoint),
        self         = this;

    endpoint.query.message = toJSON(messages);
    endpoint.query.jsonp   = callbackName;

    var cleanup = function() {
      if (!global[callbackName]) return false;
      global[callbackName] = undefined;
      try { delete global[callbackName] } catch (error) {}
      script.parentNode.removeChild(script);
    };

    global[callbackName] = function(replies) {
      cleanup();
      self._receive(replies);
    };

    script.type = 'text/javascript';
    script.src  = URI.stringify(endpoint);
    head.appendChild(script);

    script.onerror = function() {
      cleanup();
      self._handleError(messages);
    };

    return {abort: cleanup};
  }
}), {
  _cbCount: 0,

  getCallbackName: function() {
    this._cbCount += 1;
    return '__jsonp' + this._cbCount + '__';
  },

  isUsable: function(dispatcher, endpoint, callback, context) {
    callback.call(context, true);
  }
});

module.exports = JSONP;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../util/class":28,"../util/copy_object":31,"../util/extend":33,"../util/to_json":36,"../util/uri":37,"./transport":23}],23:[function(require,module,exports){
(function (process){
'use strict';

var Class    = require('../util/class'),
    Cookie   = require('../util/cookies').Cookie,
    Promise  = require('../util/promise'),
    URI      = require('../util/uri'),
    array    = require('../util/array'),
    extend   = require('../util/extend'),
    Logging  = require('../mixins/logging'),
    Timeouts = require('../mixins/timeouts'),
    Channel  = require('../protocol/channel');

var Transport = extend(Class({ className: 'Transport',
  DEFAULT_PORTS: {'http:': 80, 'https:': 443, 'ws:': 80, 'wss:': 443},
  MAX_DELAY:     0,

  batching:  true,

  initialize: function(dispatcher, endpoint) {
    this._dispatcher = dispatcher;
    this.endpoint    = endpoint;
    this._outbox     = [];
    this._proxy      = extend({}, this._dispatcher.proxy);

    if (!this._proxy.origin)
      this._proxy.origin = this._findProxy();
  },

  close: function() {},

  encode: function(messages) {
    return '';
  },

  sendMessage: function(message) {
    this.debug('Client ? sending message to ?: ?',
               this._dispatcher.clientId, URI.stringify(this.endpoint), message);

    if (!this.batching) return Promise.resolve(this.request([message]));

    this._outbox.push(message);
    this._flushLargeBatch();

    if (message.channel === Channel.HANDSHAKE)
      return this._publish(0.01);

    if (message.channel === Channel.CONNECT)
      this._connectMessage = message;

    return this._publish(this.MAX_DELAY);
  },

  _makePromise: function() {
    var self = this;

    this._requestPromise = this._requestPromise || new Promise(function(resolve) {
      self._resolvePromise = resolve;
    });
  },

  _publish: function(delay) {
    this._makePromise();

    this.addTimeout('publish', delay, function() {
      this._flush();
      delete this._requestPromise;
    }, this);

    return this._requestPromise;
  },

  _flush: function() {
    this.removeTimeout('publish');

    if (this._outbox.length > 1 && this._connectMessage)
      this._connectMessage.advice = {timeout: 0};

    this._resolvePromise(this.request(this._outbox));

    this._connectMessage = null;
    this._outbox = [];
  },

  _flushLargeBatch: function() {
    var string = this.encode(this._outbox);
    if (string.length < this._dispatcher.maxRequestSize) return;
    var last = this._outbox.pop();

    this._makePromise();
    this._flush();

    if (last) this._outbox.push(last);
  },

  _receive: function(replies) {
    if (!replies) return;
    replies = [].concat(replies);

    this.debug('Client ? received from ? via ?: ?',
               this._dispatcher.clientId, URI.stringify(this.endpoint), this.connectionType, replies);

    for (var i = 0, n = replies.length; i < n; i++)
      this._dispatcher.handleResponse(replies[i]);
  },

  _handleError: function(messages, immediate) {
    messages = [].concat(messages);

    this.debug('Client ? failed to send to ? via ?: ?',
               this._dispatcher.clientId, URI.stringify(this.endpoint), this.connectionType, messages);

    for (var i = 0, n = messages.length; i < n; i++)
      this._dispatcher.handleError(messages[i]);
  },

  _getCookies: function() {
    var cookies = this._dispatcher.cookies,
        url     = URI.stringify(this.endpoint);

    if (!cookies) return '';

    return array.map(cookies.getCookiesSync(url), function(cookie) {
      return cookie.cookieString();
    }).join('; ');
  },

  _storeCookies: function(setCookie) {
    var cookies = this._dispatcher.cookies,
        url     = URI.stringify(this.endpoint),
        cookie;

    if (!setCookie || !cookies) return;
    setCookie = [].concat(setCookie);

    for (var i = 0, n = setCookie.length; i < n; i++) {
      cookie = Cookie.parse(setCookie[i]);
      cookies.setCookieSync(cookie, url);
    }
  },

  _findProxy: function() {
    if (typeof process === 'undefined') return undefined;

    var protocol = this.endpoint.protocol;
    if (!protocol) return undefined;

    var name   = protocol.replace(/:$/, '').toLowerCase() + '_proxy',
        upcase = name.toUpperCase(),
        env    = process.env,
        keys, proxy;

    if (name === 'http_proxy' && env.REQUEST_METHOD) {
      keys = Object.keys(env).filter(function(k) { return /^http_proxy$/i.test(k) });
      if (keys.length === 1) {
        if (keys[0] === name && env[upcase] === undefined)
          proxy = env[name];
      } else if (keys.length > 1) {
        proxy = env[name];
      }
      proxy = proxy || env['CGI_' + upcase];
    } else {
      proxy = env[name] || env[upcase];
      if (proxy && !env[name])
        console.warn('The environment variable ' + upcase +
                     ' is discouraged. Use ' + name + '.');
    }
    return proxy;
  }

}), {
  get: function(dispatcher, allowed, disabled, callback, context) {
    var endpoint = dispatcher.endpoint;

    array.asyncEach(this._transports, function(pair, resume) {
      var connType     = pair[0], klass = pair[1],
          connEndpoint = dispatcher.endpointFor(connType);

      if (array.indexOf(disabled, connType) >= 0)
        return resume();

      if (array.indexOf(allowed, connType) < 0) {
        klass.isUsable(dispatcher, connEndpoint, function() {});
        return resume();
      }

      klass.isUsable(dispatcher, connEndpoint, function(isUsable) {
        if (!isUsable) return resume();
        var transport = klass.hasOwnProperty('create') ? klass.create(dispatcher, connEndpoint) : new klass(dispatcher, connEndpoint);
        callback.call(context, transport);
      });
    }, function() {
      throw new Error('Could not find a usable connection type for ' + URI.stringify(endpoint));
    });
  },

  register: function(type, klass) {
    this._transports.push([type, klass]);
    klass.prototype.connectionType = type;
  },

  getConnectionTypes: function() {
    return array.map(this._transports, function(t) { return t[0] });
  },

  _transports: []
});

extend(Transport.prototype, Logging);
extend(Transport.prototype, Timeouts);

module.exports = Transport;

}).call(this,require('_process'))

},{"../mixins/logging":7,"../mixins/timeouts":9,"../protocol/channel":10,"../util/array":26,"../util/class":28,"../util/cookies":30,"../util/extend":33,"../util/promise":34,"../util/uri":37,"_process":40}],24:[function(require,module,exports){
(function (global){
'use strict';

var Class      = require('../util/class'),
    Promise    = require('../util/promise'),
    Set        = require('../util/set'),
    URI        = require('../util/uri'),
    browser    = require('../util/browser'),
    copyObject = require('../util/copy_object'),
    extend     = require('../util/extend'),
    toJSON     = require('../util/to_json'),
    ws         = require('../util/websocket'),
    Deferrable = require('../mixins/deferrable'),
    Transport  = require('./transport');

var WebSocket = extend(Class(Transport, {
  UNCONNECTED:  1,
  CONNECTING:   2,
  CONNECTED:    3,

  batching:     false,

  isUsable: function(callback, context) {
    this.callback(function() { callback.call(context, true) });
    this.errback(function() { callback.call(context, false) });
    this.connect();
  },

  request: function(messages) {
    this._pending = this._pending || new Set();
    for (var i = 0, n = messages.length; i < n; i++) this._pending.add(messages[i]);

    var self = this;

    var promise = new Promise(function(resolve, reject) {
      self.callback(function(socket) {
        if (!socket || socket.readyState !== 1) return;
        socket.send(toJSON(messages));
        resolve(socket);
      });

      self.connect();
    });

    return {
      abort: function() { promise.then(function(ws) { ws.close() }) }
    };
  },

  connect: function() {
    if (WebSocket._unloaded) return;

    this._state = this._state || this.UNCONNECTED;
    if (this._state !== this.UNCONNECTED) return;
    this._state = this.CONNECTING;

    var socket = this._createSocket();
    if (!socket) return this.setDeferredStatus('failed');

    var self = this;

    socket.onopen = function() {
      if (socket.headers) self._storeCookies(socket.headers['set-cookie']);
      self._socket = socket;
      self._state = self.CONNECTED;
      self._everConnected = true;
      self._ping();
      self.setDeferredStatus('succeeded', socket);
    };

    var closed = false;
    socket.onclose = socket.onerror = function() {
      if (closed) return;
      closed = true;

      var wasConnected = (self._state === self.CONNECTED);
      socket.onopen = socket.onclose = socket.onerror = socket.onmessage = null;

      delete self._socket;
      self._state = self.UNCONNECTED;
      self.removeTimeout('ping');

      var pending = self._pending ? self._pending.toArray() : [];
      delete self._pending;

      if (wasConnected || self._everConnected) {
        self.setDeferredStatus('unknown');
        self._handleError(pending, wasConnected);
      } else {
        self.setDeferredStatus('failed');
      }
    };

    socket.onmessage = function(event) {
      var replies;
      try { replies = JSON.parse(event.data) } catch (error) {}

      if (!replies) return;

      replies = [].concat(replies);

      for (var i = 0, n = replies.length; i < n; i++) {
        if (replies[i].successful === undefined) continue;
        self._pending.remove(replies[i]);
      }
      self._receive(replies);
    };
  },

  close: function() {
    if (!this._socket) return;
    this._socket.close();
  },

  _createSocket: function() {
    var url        = WebSocket.getSocketUrl(this.endpoint),
        headers    = this._dispatcher.headers,
        extensions = this._dispatcher.wsExtensions,
        cookie     = this._getCookies(),
        tls        = this._dispatcher.tls,
        options    = {extensions: extensions, headers: headers, proxy: this._proxy, tls: tls};

    if (cookie !== '') options.headers['Cookie'] = cookie;

    return ws.create(url, [], options);
  },

  _ping: function() {
    if (!this._socket || this._socket.readyState !== 1) return;
    this._socket.send('[]');
    this.addTimeout('ping', this._dispatcher.timeout / 2, this._ping, this);
  }

}), {
  PROTOCOLS: {
    'http:':  'ws:',
    'https:': 'wss:'
  },

  create: function(dispatcher, endpoint) {
    var sockets = dispatcher.transports.websocket = dispatcher.transports.websocket || {};
    sockets[endpoint.href] = sockets[endpoint.href] || new this(dispatcher, endpoint);
    return sockets[endpoint.href];
  },

  getSocketUrl: function(endpoint) {
    endpoint = copyObject(endpoint);
    endpoint.protocol = this.PROTOCOLS[endpoint.protocol];
    return URI.stringify(endpoint);
  },

  isUsable: function(dispatcher, endpoint, callback, context) {
    this.create(dispatcher, endpoint).isUsable(callback, context);
  }
});

extend(WebSocket.prototype, Deferrable);

if (browser.Event && global.onbeforeunload !== undefined)
  browser.Event.on(global, 'beforeunload', function() { WebSocket._unloaded = true });

module.exports = WebSocket;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../mixins/deferrable":6,"../util/browser":27,"../util/class":28,"../util/copy_object":31,"../util/extend":33,"../util/promise":34,"../util/set":35,"../util/to_json":36,"../util/uri":37,"../util/websocket":39,"./transport":23}],25:[function(require,module,exports){
(function (global){
'use strict';

var Class     = require('../util/class'),
    URI       = require('../util/uri'),
    browser   = require('../util/browser'),
    extend    = require('../util/extend'),
    toJSON    = require('../util/to_json'),
    Transport = require('./transport');

var XHR = extend(Class(Transport, {
  encode: function(messages) {
    return toJSON(messages);
  },

  request: function(messages) {
    var href = this.endpoint.href,
        self = this,
        xhr;

    // Prefer XMLHttpRequest over ActiveXObject if they both exist
    if (global.XMLHttpRequest) {
      xhr = new XMLHttpRequest();
    } else if (global.ActiveXObject) {
      xhr = new ActiveXObject('Microsoft.XMLHTTP');
    } else {
      return this._handleError(messages);
    }

    xhr.open('POST', href, true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Pragma', 'no-cache');
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

    var headers = this._dispatcher.headers;
    for (var key in headers) {
      if (!headers.hasOwnProperty(key)) continue;
      xhr.setRequestHeader(key, headers[key]);
    }

    var abort = function() { xhr.abort() };
    if (global.onbeforeunload !== undefined)
      browser.Event.on(global, 'beforeunload', abort);

    xhr.onreadystatechange = function() {
      if (!xhr || xhr.readyState !== 4) return;

      var replies    = null,
          status     = xhr.status,
          text       = xhr.responseText,
          successful = (status >= 200 && status < 300) || status === 304 || status === 1223;

      if (global.onbeforeunload !== undefined)
        browser.Event.detach(global, 'beforeunload', abort);

      xhr.onreadystatechange = function() {};
      xhr = null;

      if (!successful) return self._handleError(messages);

      try {
        replies = JSON.parse(text);
      } catch (error) {}

      if (replies)
        self._receive(replies);
      else
        self._handleError(messages);
    };

    xhr.send(this.encode(messages));
    return xhr;
  }
}), {
  isUsable: function(dispatcher, endpoint, callback, context) {
    var usable = (navigator.product === 'ReactNative')
              || URI.isSameOrigin(endpoint);

    callback.call(context, usable);
  }
});

module.exports = XHR;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"../util/browser":27,"../util/class":28,"../util/extend":33,"../util/to_json":36,"../util/uri":37,"./transport":23}],26:[function(require,module,exports){
'use strict';

module.exports = {
  commonElement: function(lista, listb) {
    for (var i = 0, n = lista.length; i < n; i++) {
      if (this.indexOf(listb, lista[i]) !== -1)
        return lista[i];
    }
    return null;
  },

  indexOf: function(list, needle) {
    if (list.indexOf) return list.indexOf(needle);

    for (var i = 0, n = list.length; i < n; i++) {
      if (list[i] === needle) return i;
    }
    return -1;
  },

  map: function(object, callback, context) {
    if (object.map) return object.map(callback, context);
    var result = [];

    if (object instanceof Array) {
      for (var i = 0, n = object.length; i < n; i++) {
        result.push(callback.call(context || null, object[i], i));
      }
    } else {
      for (var key in object) {
        if (!object.hasOwnProperty(key)) continue;
        result.push(callback.call(context || null, key, object[key]));
      }
    }
    return result;
  },

  filter: function(array, callback, context) {
    if (array.filter) return array.filter(callback, context);
    var result = [];
    for (var i = 0, n = array.length; i < n; i++) {
      if (callback.call(context || null, array[i], i))
        result.push(array[i]);
    }
    return result;
  },

  asyncEach: function(list, iterator, callback, context) {
    var n       = list.length,
        i       = -1,
        calls   = 0,
        looping = false;

    var iterate = function() {
      calls -= 1;
      i += 1;
      if (i === n) return callback && callback.call(context);
      iterator(list[i], resume);
    };

    var loop = function() {
      if (looping) return;
      looping = true;
      while (calls > 0) iterate();
      looping = false;
    };

    var resume = function() {
      calls += 1;
      loop();
    };
    resume();
  }
};

},{}],27:[function(require,module,exports){
(function (global){
'use strict';

var Event = {
  _registry: [],

  on: function(element, eventName, callback, context) {
    var wrapped = function() { callback.call(context) };

    if (element.addEventListener)
      element.addEventListener(eventName, wrapped, false);
    else
      element.attachEvent('on' + eventName, wrapped);

    this._registry.push({
      _element:   element,
      _type:      eventName,
      _callback:  callback,
      _context:     context,
      _handler:   wrapped
    });
  },

  detach: function(element, eventName, callback, context) {
    var i = this._registry.length, register;
    while (i--) {
      register = this._registry[i];

      if ((element    && element    !== register._element)  ||
          (eventName  && eventName  !== register._type)     ||
          (callback   && callback   !== register._callback) ||
          (context    && context    !== register._context))
        continue;

      if (register._element.removeEventListener)
        register._element.removeEventListener(register._type, register._handler, false);
      else
        register._element.detachEvent('on' + register._type, register._handler);

      this._registry.splice(i,1);
      register = null;
    }
  }
};

if (global.onunload !== undefined)
  Event.on(global, 'unload', Event.detach, Event);

module.exports = {
  Event: Event
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],28:[function(require,module,exports){
'use strict';

var extend = require('./extend');

module.exports = function(parent, methods) {
  if (typeof parent !== 'function') {
    methods = parent;
    parent  = Object;
  }

  var klass = function() {
    if (!this.initialize) return this;
    return this.initialize.apply(this, arguments) || this;
  };

  var bridge = function() {};
  bridge.prototype = parent.prototype;

  klass.prototype = new bridge();
  extend(klass.prototype, methods);

  return klass;
};

},{"./extend":33}],29:[function(require,module,exports){
module.exports = {
  VERSION:          '1.2.4',

  BAYEUX_VERSION:   '1.0',
  ID_LENGTH:        160,
  JSONP_CALLBACK:   'jsonpcallback',
  CONNECTION_TYPES: ['long-polling', 'cross-origin-long-polling', 'callback-polling', 'websocket', 'eventsource', 'in-process'],

  MANDATORY_CONNECTION_TYPES: ['long-polling', 'callback-polling', 'in-process']
};

},{}],30:[function(require,module,exports){
'use strict';

module.exports = {};

},{}],31:[function(require,module,exports){
'use strict';

var copyObject = function(object) {
  var clone, i, key;
  if (object instanceof Array) {
    clone = [];
    i = object.length;
    while (i--) clone[i] = copyObject(object[i]);
    return clone;
  } else if (typeof object === 'object') {
    clone = (object === null) ? null : {};
    for (key in object) clone[key] = copyObject(object[key]);
    return clone;
  } else {
    return object;
  }
};

module.exports = copyObject;

},{}],32:[function(require,module,exports){
/*
Copyright Joyent, Inc. and other Node contributors. All rights reserved.
Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.prototype.toString.call(xs) === '[object Array]'
    }
;
function indexOf (xs, x) {
    if (xs.indexOf) return xs.indexOf(x);
    for (var i = 0; i < xs.length; i++) {
        if (x === xs[i]) return i;
    }
    return -1;
}

function EventEmitter() {}
module.exports = EventEmitter;

EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {
    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = indexOf(list, listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (arguments.length === 0) {
    this._events = {};
    return this;
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

},{}],33:[function(require,module,exports){
'use strict';

module.exports = function(dest, source, overwrite) {
  if (!source) return dest;
  for (var key in source) {
    if (!source.hasOwnProperty(key)) continue;
    if (dest.hasOwnProperty(key) && overwrite === false) continue;
    if (dest[key] !== source[key])
      dest[key] = source[key];
  }
  return dest;
};

},{}],34:[function(require,module,exports){
'use strict';

var asap = require('asap');

var PENDING   = 0,
    FULFILLED = 1,
    REJECTED  = 2;

var RETURN = function(x) { return x },
    THROW  = function(x) { throw  x };

var Promise = function(task) {
  this._state       = PENDING;
  this._onFulfilled = [];
  this._onRejected  = [];

  if (typeof task !== 'function') return;
  var self = this;

  task(function(value)  { resolve(self, value) },
       function(reason) { reject(self, reason) });
};

Promise.prototype.then = function(onFulfilled, onRejected) {
  var next = new Promise();
  registerOnFulfilled(this, onFulfilled, next);
  registerOnRejected(this, onRejected, next);
  return next;
};

Promise.prototype['catch'] = function(onRejected) {
  return this.then(null, onRejected);
};

var registerOnFulfilled = function(promise, onFulfilled, next) {
  if (typeof onFulfilled !== 'function') onFulfilled = RETURN;
  var handler = function(value) { invoke(onFulfilled, value, next) };

  if (promise._state === PENDING) {
    promise._onFulfilled.push(handler);
  } else if (promise._state === FULFILLED) {
    handler(promise._value);
  }
};

var registerOnRejected = function(promise, onRejected, next) {
  if (typeof onRejected !== 'function') onRejected = THROW;
  var handler = function(reason) { invoke(onRejected, reason, next) };

  if (promise._state === PENDING) {
    promise._onRejected.push(handler);
  } else if (promise._state === REJECTED) {
    handler(promise._reason);
  }
};

var invoke = function(fn, value, next) {
  asap(function() { _invoke(fn, value, next) });
};

var _invoke = function(fn, value, next) {
  var outcome;

  try {
    outcome = fn(value);
  } catch (error) {
    return reject(next, error);
  }

  if (outcome === next) {
    reject(next, new TypeError('Recursive promise chain detected'));
  } else {
    resolve(next, outcome);
  }
};

var resolve = function(promise, value) {
  var called = false, type, then;

  try {
    type = typeof value;
    then = value !== null && (type === 'function' || type === 'object') && value.then;

    if (typeof then !== 'function') return fulfill(promise, value);

    then.call(value, function(v) {
      if (!(called ^ (called = true))) return;
      resolve(promise, v);
    }, function(r) {
      if (!(called ^ (called = true))) return;
      reject(promise, r);
    });
  } catch (error) {
    if (!(called ^ (called = true))) return;
    reject(promise, error);
  }
};

var fulfill = function(promise, value) {
  if (promise._state !== PENDING) return;

  promise._state      = FULFILLED;
  promise._value      = value;
  promise._onRejected = [];

  var onFulfilled = promise._onFulfilled, fn;
  while (fn = onFulfilled.shift()) fn(value);
};

var reject = function(promise, reason) {
  if (promise._state !== PENDING) return;

  promise._state       = REJECTED;
  promise._reason      = reason;
  promise._onFulfilled = [];

  var onRejected = promise._onRejected, fn;
  while (fn = onRejected.shift()) fn(reason);
};

Promise.resolve = function(value) {
  return new Promise(function(resolve, reject) { resolve(value) });
};

Promise.reject = function(reason) {
  return new Promise(function(resolve, reject) { reject(reason) });
};

Promise.all = function(promises) {
  return new Promise(function(resolve, reject) {
    var list = [], n = promises.length, i;

    if (n === 0) return resolve(list);

    for (i = 0; i < n; i++) (function(promise, i) {
      Promise.resolve(promise).then(function(value) {
        list[i] = value;
        if (--n === 0) resolve(list);
      }, reject);
    })(promises[i], i);
  });
};

Promise.race = function(promises) {
  return new Promise(function(resolve, reject) {
    for (var i = 0, n = promises.length; i < n; i++)
      Promise.resolve(promises[i]).then(resolve, reject);
  });
};

Promise.deferred = Promise.pending = function() {
  var tuple = {};

  tuple.promise = new Promise(function(resolve, reject) {
    tuple.resolve = resolve;
    tuple.reject  = reject;
  });
  return tuple;
};

module.exports = Promise;

},{"asap":3}],35:[function(require,module,exports){
'use strict';

var Class = require('./class');

module.exports = Class({
  initialize: function() {
    this._index = {};
  },

  add: function(item) {
    var key = (item.id !== undefined) ? item.id : item;
    if (this._index.hasOwnProperty(key)) return false;
    this._index[key] = item;
    return true;
  },

  forEach: function(block, context) {
    for (var key in this._index) {
      if (this._index.hasOwnProperty(key))
        block.call(context, this._index[key]);
    }
  },

  isEmpty: function() {
    for (var key in this._index) {
      if (this._index.hasOwnProperty(key)) return false;
    }
    return true;
  },

  member: function(item) {
    for (var key in this._index) {
      if (this._index[key] === item) return true;
    }
    return false;
  },

  remove: function(item) {
    var key = (item.id !== undefined) ? item.id : item;
    var removed = this._index[key];
    delete this._index[key];
    return removed;
  },

  toArray: function() {
    var array = [];
    this.forEach(function(item) { array.push(item) });
    return array;
  }
});

},{"./class":28}],36:[function(require,module,exports){
'use strict';

// http://assanka.net/content/tech/2009/09/02/json2-js-vs-prototype/

module.exports = function(object) {
  return JSON.stringify(object, function(key, value) {
    return (this[key] instanceof Array) ? this[key] : value;
  });
};

},{}],37:[function(require,module,exports){
'use strict';

module.exports = {
  isURI: function(uri) {
    return uri && uri.protocol && uri.host && uri.path;
  },

  isSameOrigin: function(uri) {
    return uri.protocol === location.protocol &&
           uri.hostname === location.hostname &&
           uri.port     === location.port;
  },

  parse: function(url) {
    if (typeof url !== 'string') return url;
    var uri = {}, parts, query, pairs, i, n, data;

    var consume = function(name, pattern) {
      url = url.replace(pattern, function(match) {
        uri[name] = match;
        return '';
      });
      uri[name] = uri[name] || '';
    };

    consume('protocol', /^[a-z]+\:/i);
    consume('host',     /^\/\/[^\/\?#]+/);

    if (!/^\//.test(url) && !uri.host)
      url = location.pathname.replace(/[^\/]*$/, '') + url;

    consume('pathname', /^[^\?#]*/);
    consume('search',   /^\?[^#]*/);
    consume('hash',     /^#.*/);

    uri.protocol = uri.protocol || location.protocol;

    if (uri.host) {
      uri.host     = uri.host.substr(2);
      parts        = uri.host.split(':');
      uri.hostname = parts[0];
      uri.port     = parts[1] || '';
    } else {
      uri.host     = location.host;
      uri.hostname = location.hostname;
      uri.port     = location.port;
    }

    uri.pathname = uri.pathname || '/';
    uri.path = uri.pathname + uri.search;

    query = uri.search.replace(/^\?/, '');
    pairs = query ? query.split('&') : [];
    data  = {};

    for (i = 0, n = pairs.length; i < n; i++) {
      parts = pairs[i].split('=');
      data[decodeURIComponent(parts[0] || '')] = decodeURIComponent(parts[1] || '');
    }

    uri.query = data;

    uri.href = this.stringify(uri);
    return uri;
  },

  stringify: function(uri) {
    var string = uri.protocol + '//' + uri.hostname;
    if (uri.port) string += ':' + uri.port;
    string += uri.pathname + this.queryString(uri.query) + (uri.hash || '');
    return string;
  },

  queryString: function(query) {
    var pairs = [];
    for (var key in query) {
      if (!query.hasOwnProperty(key)) continue;
      pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(query[key]));
    }
    if (pairs.length === 0) return '';
    return '?' + pairs.join('&');
  }
};

},{}],38:[function(require,module,exports){
'use strict';

var array = require('./array');

module.exports = function(options, validKeys) {
  for (var key in options) {
    if (array.indexOf(validKeys, key) < 0)
      throw new Error('Unrecognized option: ' + key);
  }
};

},{"./array":26}],39:[function(require,module,exports){
(function (global){
'use strict';

var WS = global.MozWebSocket || global.WebSocket;

module.exports = {
  create: function(url, protocols, options) {
    if (typeof WS !== 'function') return null;
    return new WS(url);
  }
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],40:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}]},{},[2])(2)
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJsaWIvYXBpL3N0cmVhbWluZy1leHRlbnNpb24uanMiLCJsaWIvYXBpL3N0cmVhbWluZy5qcyIsIm5vZGVfbW9kdWxlcy9hc2FwL2Jyb3dzZXItYXNhcC5qcyIsIm5vZGVfbW9kdWxlcy9hc2FwL2Jyb3dzZXItcmF3LmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL2ZheWVfYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9taXhpbnMvZGVmZXJyYWJsZS5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9taXhpbnMvbG9nZ2luZy5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9taXhpbnMvcHVibGlzaGVyLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL21peGlucy90aW1lb3V0cy5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9wcm90b2NvbC9jaGFubmVsLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3Byb3RvY29sL2NsaWVudC5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9wcm90b2NvbC9kaXNwYXRjaGVyLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3Byb3RvY29sL2Vycm9yLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3Byb3RvY29sL2V4dGVuc2libGUuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvcHJvdG9jb2wvZ3JhbW1hci5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9wcm90b2NvbC9wdWJsaWNhdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy9wcm90b2NvbC9zY2hlZHVsZXIuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvcHJvdG9jb2wvc3Vic2NyaXB0aW9uLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3RyYW5zcG9ydC9icm93c2VyX3RyYW5zcG9ydHMuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdHJhbnNwb3J0L2NvcnMuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdHJhbnNwb3J0L2V2ZW50X3NvdXJjZS5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy90cmFuc3BvcnQvanNvbnAuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdHJhbnNwb3J0L3RyYW5zcG9ydC5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy90cmFuc3BvcnQvd2ViX3NvY2tldC5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy90cmFuc3BvcnQveGhyLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3V0aWwvYXJyYXkuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdXRpbC9icm93c2VyL2V2ZW50LmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3V0aWwvY2xhc3MuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdXRpbC9jb25zdGFudHMuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdXRpbC9jb29raWVzL2Jyb3dzZXJfY29va2llcy5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy91dGlsL2NvcHlfb2JqZWN0LmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3V0aWwvZXZlbnRfZW1pdHRlci5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy91dGlsL2V4dGVuZC5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy91dGlsL3Byb21pc2UuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdXRpbC9zZXQuanMiLCJub2RlX21vZHVsZXMvZmF5ZS9zcmMvdXRpbC90b19qc29uLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3V0aWwvdXJpLmpzIiwibm9kZV9tb2R1bGVzL2ZheWUvc3JjL3V0aWwvdmFsaWRhdGVfb3B0aW9ucy5qcyIsIm5vZGVfbW9kdWxlcy9mYXllL3NyYy91dGlsL3dlYnNvY2tldC9icm93c2VyX3dlYnNvY2tldC5qcyIsIm5vZGVfbW9kdWxlcy9wcm9jZXNzL2Jyb3dzZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNsRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQy9OQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDMUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNwSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2xZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN6TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDUkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ2hFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7OztBQ25OQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDaktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNsRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUMxRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNWQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbigpe2Z1bmN0aW9uIHIoZSxuLHQpe2Z1bmN0aW9uIG8oaSxmKXtpZighbltpXSl7aWYoIWVbaV0pe3ZhciBjPVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmU7aWYoIWYmJmMpcmV0dXJuIGMoaSwhMCk7aWYodSlyZXR1cm4gdShpLCEwKTt2YXIgYT1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK2krXCInXCIpO3Rocm93IGEuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixhfXZhciBwPW5baV09e2V4cG9ydHM6e319O2VbaV1bMF0uY2FsbChwLmV4cG9ydHMsZnVuY3Rpb24ocil7dmFyIG49ZVtpXVsxXVtyXTtyZXR1cm4gbyhufHxyKX0scCxwLmV4cG9ydHMscixlLG4sdCl9cmV0dXJuIG5baV0uZXhwb3J0c31mb3IodmFyIHU9XCJmdW5jdGlvblwiPT10eXBlb2YgcmVxdWlyZSYmcmVxdWlyZSxpPTA7aTx0Lmxlbmd0aDtpKyspbyh0W2ldKTtyZXR1cm4gb31yZXR1cm4gcn0pKCkiLCIvKipcbiAqIEZheWUgQ2xpZW50IGV4dGVuc2lvbnM6IGh0dHBzOi8vZmF5ZS5qY29nbGFuLmNvbS9icm93c2VyL2V4dGVuc2lvbnMuaHRtbFxuICpcbiAqIEZvciB1c2Ugd2l0aCBTdHJlYW1pbmcucHJvdG90eXBlLmNyZWF0ZUNsaWVudCgpXG4qKi9cbnZhciBTdHJlYW1pbmdFeHRlbnNpb24gPSB7fTtcblxuLyoqXG4gKiBDb25zdHJ1Y3RvciBmb3IgYW4gYXV0aCBmYWlsdXJlIGRldGVjdG9yIGV4dGVuc2lvblxuICpcbiAqIEJhc2VkIG9uIG5ldyBmZWF0dXJlIHJlbGVhc2VkIHdpdGggU2FsZXNmb3JjZSBTcHJpbmcgJzE4OlxuICogaHR0cHM6Ly9yZWxlYXNlbm90ZXMuZG9jcy5zYWxlc2ZvcmNlLmNvbS9lbi11cy9zcHJpbmcxOC9yZWxlYXNlLW5vdGVzL3JuX21lc3NhZ2luZ19jb21ldGRfYXV0aF92YWxpZGF0aW9uLmh0bT9lZGl0aW9uPSZpbXBhY3Q9XG4gKlxuICogRXhhbXBsZSB0cmlnZ2VyaW5nIGVycm9yIG1lc3NhZ2U6XG4gKlxuICogYGBgXG4gKiB7XG4gKiAgIFwiZXh0XCI6e1xuICogICAgIFwic2ZkY1wiOntcImZhaWx1cmVSZWFzb25cIjpcIjQwMTo6QXV0aGVudGljYXRpb24gaW52YWxpZFwifSxcbiAqICAgICBcInJlcGxheVwiOnRydWV9LFxuICogICBcImFkdmljZVwiOntcInJlY29ubmVjdFwiOlwibm9uZVwifSxcbiAqICAgXCJjaGFubmVsXCI6XCIvbWV0YS9oYW5kc2hha2VcIixcbiAqICAgXCJlcnJvclwiOlwiNDAzOjpIYW5kc2hha2UgZGVuaWVkXCIsXG4gKiAgIFwic3VjY2Vzc2Z1bFwiOmZhbHNlXG4gKiB9XG4gKiBgYGBcbiAqXG4gKiBFeGFtcGxlIHVzYWdlOlxuICpcbiAqIGBgYGphdmFzY3JpcHRcbiAqIGNvbnN0IGNvbm4gPSBuZXcganNmb3JjZS5Db25uZWN0aW9uKHsg4oCmIH0pO1xuICogXG4gKiBjb25zdCBjaGFubmVsID0gXCIvZXZlbnQvTXlfRXZlbnRfX2VcIjtcbiAqIFxuICogLy8gRXhpdCB0aGUgTm9kZSBwcm9jZXNzIHdoZW4gYXV0aCBmYWlsc1xuICogY29uc3QgZXhpdENhbGxiYWNrID0gKCkgPT4gcHJvY2Vzcy5leGl0KDEpO1xuICogY29uc3QgYXV0aEZhaWx1cmVFeHQgPSBuZXcganNmb3JjZS5TdHJlYW1pbmdFeHRlbnNpb24uQXV0aEZhaWx1cmUoZXhpdENhbGxiYWNrKTtcbiAqIFxuICogY29uc3QgZmF5ZUNsaWVudCA9IGNvbm4uc3RyZWFtaW5nLmNyZWF0ZUNsaWVudChbIGF1dGhGYWlsdXJlRXh0IF0pO1xuICogXG4gKiBjb25zdCBzdWJzY3JpcHRpb24gPSBmYXllQ2xpZW50LnN1YnNjcmliZShjaGFubmVsLCBkYXRhID0+IHtcbiAqICAgY29uc29sZS5sb2coJ3RvcGljIHJlY2VpdmVkIGRhdGEnLCBkYXRhKTtcbiAqIH0pO1xuICogXG4gKiBzdWJzY3JpcHRpb24uY2FuY2VsKCk7XG4gKiBgYGBcbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmYWlsdXJlQ2FsbGJhY2sgLSBJbnZva2VkIHdoZW4gYXV0aGVudGljYXRpb24gYmVjb21lcyBpbnZhbGlkXG4gKi9cblN0cmVhbWluZ0V4dGVuc2lvbi5BdXRoRmFpbHVyZSA9IGZ1bmN0aW9uKGZhaWx1cmVDYWxsYmFjaykge1xuICB0aGlzLmluY29taW5nID0gZnVuY3Rpb24obWVzc2FnZSwgY2FsbGJhY2spIHtcbiAgICBpZiAoXG4gICAgICAobWVzc2FnZS5jaGFubmVsID09PSAnL21ldGEvY29ubmVjdCcgfHxcbiAgICAgICAgbWVzc2FnZS5jaGFubmVsID09PSAnL21ldGEvaGFuZHNoYWtlJylcbiAgICAgICYmIG1lc3NhZ2UuYWR2aWNlXG4gICAgICAmJiBtZXNzYWdlLmFkdmljZS5yZWNvbm5lY3QgPT0gJ25vbmUnXG4gICAgKSB7XG4gICAgICBmYWlsdXJlQ2FsbGJhY2sobWVzc2FnZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNhbGxiYWNrKG1lc3NhZ2UpO1xuICAgIH1cbiAgfVxufTtcblxuLyoqXG4gKiBDb25zdHJ1Y3RvciBmb3IgYSBkdXJhYmxlIHN0cmVhbWluZyByZXBsYXkgZXh0ZW5zaW9uXG4gKlxuICogTW9kaWZpZWQgZnJvbSBvcmlnaW5hbCBTYWxlc2ZvcmNlIGRlbW8gc291cmNlIGNvZGU6XG4gKiBodHRwczovL2dpdGh1Yi5jb20vZGV2ZWxvcGVyZm9yY2UvU2FsZXNmb3JjZUR1cmFibGVTdHJlYW1pbmdEZW1vL2Jsb2IvM2Q0YTU2ZWFjOTU2Zjc0NGFkNmMyMmU2YTgxNDFiNmZlYjU3YWJiOS9zdGF0aWNyZXNvdXJjZXMvY29tZXRkUmVwbGF5RXh0ZW5zaW9uLnJlc291cmNlXG4gKiBcbiAqIEV4YW1wbGUgdXNhZ2U6XG4gKlxuICogYGBgamF2YXNjcmlwdFxuICogY29uc3QgY29ubiA9IG5ldyBqc2ZvcmNlLkNvbm5lY3Rpb24oeyDigKYgfSk7XG4gKiBcbiAqIGNvbnN0IGNoYW5uZWwgPSBcIi9ldmVudC9NeV9FdmVudF9fZVwiO1xuICogY29uc3QgcmVwbGF5SWQgPSAtMjsgLy8gLTIgaXMgYWxsIHJldGFpbmVkIGV2ZW50c1xuICogXG4gKiBjb25zdCByZXBsYXlFeHQgPSBuZXcganNmb3JjZS5TdHJlYW1pbmdFeHRlbnNpb24uUmVwbGF5KGNoYW5uZWwsIHJlcGxheUlkKTtcbiAqIFxuICogY29uc3QgZmF5ZUNsaWVudCA9IGNvbm4uc3RyZWFtaW5nLmNyZWF0ZUNsaWVudChbIHJlcGxheUV4dCBdKTtcbiAqIFxuICogY29uc3Qgc3Vic2NyaXB0aW9uID0gZmF5ZUNsaWVudC5zdWJzY3JpYmUoY2hhbm5lbCwgZGF0YSA9PiB7XG4gKiAgIGNvbnNvbGUubG9nKCd0b3BpYyByZWNlaXZlZCBkYXRhJywgZGF0YSk7XG4gKiB9KTtcbiAqIFxuICogc3Vic2NyaXB0aW9uLmNhbmNlbCgpO1xuICogYGBgXG4gKi9cblN0cmVhbWluZ0V4dGVuc2lvbi5SZXBsYXkgPSBmdW5jdGlvbihjaGFubmVsLCByZXBsYXlJZCkge1xuICB2YXIgUkVQTEFZX0ZST01fS0VZID0gXCJyZXBsYXlcIjtcbiAgXG4gIHZhciBfZXh0ZW5zaW9uRW5hYmxlZCA9IHJlcGxheUlkICE9IG51bGwgPyB0cnVlIDogZmFsc2U7XG4gIHZhciBfcmVwbGF5ID0gcmVwbGF5SWQ7XG4gIHZhciBfY2hhbm5lbCA9IGNoYW5uZWw7XG5cbiAgdGhpcy5zZXRFeHRlbnNpb25FbmFibGVkID0gZnVuY3Rpb24oZXh0ZW5zaW9uRW5hYmxlZCkge1xuICAgIF9leHRlbnNpb25FbmFibGVkID0gZXh0ZW5zaW9uRW5hYmxlZDtcbiAgfVxuXG4gIHRoaXMuc2V0UmVwbGF5ID0gZnVuY3Rpb24gKHJlcGxheSkge1xuICAgIF9yZXBsYXkgPSBwYXJzZUludChyZXBsYXksIDEwKTtcbiAgfVxuXG4gIHRoaXMuc2V0Q2hhbm5lbCA9IGZ1bmN0aW9uKGNoYW5uZWwpIHtcbiAgICBfY2hhbm5lbCA9IGNoYW5uZWw7XG4gIH1cblxuICB0aGlzLmluY29taW5nID0gZnVuY3Rpb24obWVzc2FnZSwgY2FsbGJhY2spIHtcbiAgICBpZiAobWVzc2FnZS5jaGFubmVsID09PSAnL21ldGEvaGFuZHNoYWtlJykge1xuICAgICAgaWYgKG1lc3NhZ2UuZXh0ICYmIG1lc3NhZ2UuZXh0W1JFUExBWV9GUk9NX0tFWV0gPT0gdHJ1ZSkge1xuICAgICAgICBfZXh0ZW5zaW9uRW5hYmxlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChtZXNzYWdlLmNoYW5uZWwgPT09IF9jaGFubmVsICYmIG1lc3NhZ2UuZGF0YSAmJiBtZXNzYWdlLmRhdGEuZXZlbnQgJiYgbWVzc2FnZS5kYXRhLmV2ZW50LnJlcGxheUlkKSB7XG4gICAgICBfcmVwbGF5ID0gbWVzc2FnZS5kYXRhLmV2ZW50LnJlcGxheUlkO1xuICAgIH1cbiAgICBjYWxsYmFjayhtZXNzYWdlKTtcbiAgfVxuICBcbiAgdGhpcy5vdXRnb2luZyA9IGZ1bmN0aW9uKG1lc3NhZ2UsIGNhbGxiYWNrKSB7XG4gICAgaWYgKG1lc3NhZ2UuY2hhbm5lbCA9PT0gJy9tZXRhL3N1YnNjcmliZScgJiYgbWVzc2FnZS5zdWJzY3JpcHRpb24gPT09IF9jaGFubmVsKSB7XG4gICAgICBpZiAoX2V4dGVuc2lvbkVuYWJsZWQpIHtcbiAgICAgICAgaWYgKCFtZXNzYWdlLmV4dCkgeyBtZXNzYWdlLmV4dCA9IHt9OyB9XG5cbiAgICAgICAgdmFyIHJlcGxheUZyb21NYXAgPSB7fTtcbiAgICAgICAgcmVwbGF5RnJvbU1hcFtfY2hhbm5lbF0gPSBfcmVwbGF5O1xuXG4gICAgICAgIC8vIGFkZCBcImV4dCA6IHsgXCJyZXBsYXlcIiA6IHsgQ0hBTk5FTCA6IFJFUExBWV9WQUxVRSB9fVwiIHRvIHN1YnNjcmliZSBtZXNzYWdlXG4gICAgICAgIG1lc3NhZ2UuZXh0W1JFUExBWV9GUk9NX0tFWV0gPSByZXBsYXlGcm9tTWFwO1xuICAgICAgfVxuICAgIH1cbiAgICBjYWxsYmFjayhtZXNzYWdlKTtcbiAgfTtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyZWFtaW5nRXh0ZW5zaW9uO1xuIiwiLyoqXG4gKiBAZmlsZSBNYW5hZ2VzIFN0cmVhbWluZyBBUElzXG4gKiBAYXV0aG9yIFNoaW5pY2hpIFRvbWl0YSA8c2hpbmljaGkudG9taXRhQGdtYWlsLmNvbT5cbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBldmVudHMgPSB3aW5kb3cuanNmb3JjZS5yZXF1aXJlKCdldmVudHMnKSxcbiAgICBpbmhlcml0cyA9IHdpbmRvdy5qc2ZvcmNlLnJlcXVpcmUoJ2luaGVyaXRzJyksXG4gICAgXyA9IHdpbmRvdy5qc2ZvcmNlLnJlcXVpcmUoJ2xvZGFzaC9jb3JlJyksXG4gICAgRmF5ZSAgID0gcmVxdWlyZSgnZmF5ZScpLFxuICAgIFN0cmVhbWluZ0V4dGVuc2lvbiA9IHJlcXVpcmUoJy4vc3RyZWFtaW5nLWV4dGVuc2lvbicpLFxuICAgIGpzZm9yY2UgPSB3aW5kb3cuanNmb3JjZS5yZXF1aXJlKCcuL2NvcmUnKTtcblxuLyoqXG4gKiBTdHJlYW1pbmcgQVBJIHRvcGljIGNsYXNzXG4gKlxuICogQGNsYXNzIFN0cmVhbWluZ35Ub3BpY1xuICogQHBhcmFtIHtTdHJlYW1pbmd9IHN0ZWFtaW5nIC0gU3RyZWFtaW5nIEFQSSBvYmplY3RcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIC0gVG9waWMgbmFtZVxuICovXG52YXIgVG9waWMgPSBmdW5jdGlvbihzdHJlYW1pbmcsIG5hbWUpIHtcbiAgdGhpcy5fc3RyZWFtaW5nID0gc3RyZWFtaW5nO1xuICB0aGlzLm5hbWUgPSBuYW1lO1xufTtcblxuLyoqXG4gKiBAdHlwZWRlZiB7T2JqZWN0fSBTdHJlYW1pbmd+U3RyZWFtaW5nTWVzc2FnZVxuICogQHByb3Age09iamVjdH0gZXZlbnRcbiAqIEBwcm9wIHtPYmplY3R9IGV2ZW50LnR5cGUgLSBFdmVudCB0eXBlXG4gKiBAcHJvcCB7UmVjb3JkfSBzb2JqZWN0IC0gUmVjb3JkIGluZm9ybWF0aW9uXG4gKi9cbi8qKlxuICogU3Vic2NyaWJlIGxpc3RlbmVyIHRvIHRvcGljXG4gKlxuICogQG1ldGhvZCBTdHJlYW1pbmd+VG9waWMjc3Vic2NyaWJlXG4gKiBAcGFyYW0ge0NhbGxiYWNrLjxTdHJlYW1pbmd+U3RyZWFtaW5nTWVzYXNnZT59IGxpc3RlbmVyIC0gU3RyZWFtaW5nIG1lc3NhZ2UgbGlzdGVuZXJcbiAqIEByZXR1cm5zIHtTdWJzY3JpcHRpb259IC0gRmF5ZSBzdWJzY3JpcHRpb24gb2JqZWN0XG4gKi9cblRvcGljLnByb3RvdHlwZS5zdWJzY3JpYmUgPSBmdW5jdGlvbihsaXN0ZW5lcikge1xuICByZXR1cm4gdGhpcy5fc3RyZWFtaW5nLnN1YnNjcmliZSh0aGlzLm5hbWUsIGxpc3RlbmVyKTtcbn07XG5cbi8qKlxuICogVW5zdWJzY3JpYmUgbGlzdGVuZXIgZnJvbSB0b3BpY1xuICpcbiAqIEBtZXRob2QgU3RyZWFtaW5nflRvcGljI3Vuc3Vic2NyaWJlXG4gKiBAcGFyYW0ge0NhbGxiYWNrLjxTdHJlYW1pbmd+U3RyZWFtaW5nTWVzYXNnZT59IGxpc3RlbmVyIC0gU3RyZWFtaW5nIG1lc3NhZ2UgbGlzdGVuZXJcbiAqIEByZXR1cm5zIHtTdHJlYW1pbmd+VG9waWN9XG4gKi9cblRvcGljLnByb3RvdHlwZS51bnN1YnNjcmliZSA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIHRoaXMuX3N0cmVhbWluZy51bnN1YnNjcmliZSh0aGlzLm5hbWUsIGxpc3RlbmVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKi0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tKi9cblxuLyoqXG4gKiBTdHJlYW1pbmcgQVBJIEdlbmVyaWMgU3RyZWFtaW5nIENoYW5uZWxcbiAqXG4gKiBAY2xhc3MgU3RyZWFtaW5nfkNoYW5uZWxcbiAqIEBwYXJhbSB7U3RyZWFtaW5nfSBzdGVhbWluZyAtIFN0cmVhbWluZyBBUEkgb2JqZWN0XG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZSAtIENoYW5uZWwgbmFtZSAoc3RhcnRzIHdpdGggXCIvdS9cIilcbiAqL1xudmFyIENoYW5uZWwgPSBmdW5jdGlvbihzdHJlYW1pbmcsIG5hbWUpIHtcbiAgdGhpcy5fc3RyZWFtaW5nID0gc3RyZWFtaW5nO1xuICB0aGlzLl9uYW1lID0gbmFtZTtcbn07XG5cbi8qKlxuICogU3Vic2NyaWJlIHRvIGNoYW5uZWxcbiAqXG4gKiBAcGFyYW0ge0NhbGxiYWNrLjxTdHJlYW1pbmd+U3RyZWFtaW5nTWVzc2FnZT59IGxpc3RlbmVyIC0gU3RyZWFtaW5nIG1lc3NhZ2UgbGlzdGVuZXJcbiAqIEByZXR1cm5zIHtTdWJzY3JpcHRpb259IC0gRmF5ZSBzdWJzY3JpcHRpb24gb2JqZWN0XG4gKi9cbkNoYW5uZWwucHJvdG90eXBlLnN1YnNjcmliZSA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIHJldHVybiB0aGlzLl9zdHJlYW1pbmcuc3Vic2NyaWJlKHRoaXMuX25hbWUsIGxpc3RlbmVyKTtcbn07XG5cbkNoYW5uZWwucHJvdG90eXBlLnVuc3Vic2NyaWJlID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgdGhpcy5fc3RyZWFtaW5nLnVuc3Vic2NyaWJlKHRoaXMuX25hbWUsIGxpc3RlbmVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5DaGFubmVsLnByb3RvdHlwZS5wdXNoID0gZnVuY3Rpb24oZXZlbnRzLCBjYWxsYmFjaykge1xuICB2YXIgaXNBcnJheSA9IF8uaXNBcnJheShldmVudHMpO1xuICBldmVudHMgPSBpc0FycmF5ID8gZXZlbnRzIDogWyBldmVudHMgXTtcbiAgdmFyIGNvbm4gPSB0aGlzLl9zdHJlYW1pbmcuX2Nvbm47XG4gIGlmICghdGhpcy5faWQpIHtcbiAgICB0aGlzLl9pZCA9IGNvbm4uc29iamVjdCgnU3RyZWFtaW5nQ2hhbm5lbCcpLmZpbmRPbmUoeyBOYW1lOiB0aGlzLl9uYW1lIH0sICdJZCcpXG4gICAgICAudGhlbihmdW5jdGlvbihyZWMpIHsgcmV0dXJuIHJlYy5JZCB9KTtcbiAgfVxuICByZXR1cm4gdGhpcy5faWQudGhlbihmdW5jdGlvbihpZCkge1xuICAgIHZhciBjaGFubmVsVXJsID0gJy9zb2JqZWN0cy9TdHJlYW1pbmdDaGFubmVsLycgKyBpZCArICcvcHVzaCc7XG4gICAgcmV0dXJuIGNvbm4ucmVxdWVzdFBvc3QoY2hhbm5lbFVybCwgeyBwdXNoRXZlbnRzOiBldmVudHMgfSk7XG4gIH0pLnRoZW4oZnVuY3Rpb24ocmV0cykge1xuICAgIHJldHVybiBpc0FycmF5ID8gcmV0cyA6IHJldHNbMF07XG4gIH0pLnRoZW5DYWxsKGNhbGxiYWNrKTtcbn07XG5cbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuXG4vKipcbiAqIFN0cmVhbWluZyBBUEkgY2xhc3NcbiAqXG4gKiBAY2xhc3NcbiAqIEBleHRlbmRzIGV2ZW50cy5FdmVudEVtaXR0ZXJcbiAqIEBwYXJhbSB7Q29ubmVjdGlvbn0gY29ubiAtIENvbm5lY3Rpb24gb2JqZWN0XG4gKi9cbnZhciBTdHJlYW1pbmcgPSBmdW5jdGlvbihjb25uKSB7XG4gIHRoaXMuX2Nvbm4gPSBjb25uO1xufTtcblxuaW5oZXJpdHMoU3RyZWFtaW5nLCBldmVudHMuRXZlbnRFbWl0dGVyKTtcblxuLyoqIEBwcml2YXRlICoqL1xuU3RyZWFtaW5nLnByb3RvdHlwZS5fY3JlYXRlQ2xpZW50ID0gZnVuY3Rpb24oZm9yQ2hhbm5lbE5hbWUsIGV4dGVuc2lvbnMpIHtcbiAgLy8gZm9yQ2hhbm5lbE5hbWUgaXMgYWR2aXNvcnksIGZvciBhbiBBUEkgd29ya2Fyb3VuZC4gSXQgZG9lcyBub3QgcmVzdHJpY3Qgb3Igc2VsZWN0IHRoZSBjaGFubmVsLlxuICB2YXIgbmVlZHNSZXBsYXlGaXggPSB0eXBlb2YgZm9yQ2hhbm5lbE5hbWUgPT09ICdzdHJpbmcnICYmIGZvckNoYW5uZWxOYW1lLmluZGV4T2YoJy91LycpID09PSAwO1xuICB2YXIgZW5kcG9pbnRVcmwgPSBbXG4gICAgdGhpcy5fY29ubi5pbnN0YW5jZVVybCxcbiAgICAvLyBzcGVjaWFsIGVuZHBvaW50IFwiL2NvbWV0ZC9yZXBsYXkveHgueFwiIGlzIG9ubHkgYXZhaWxhYmxlIGluIDM2LjAuXG4gICAgLy8gU2VlIGh0dHBzOi8vcmVsZWFzZW5vdGVzLmRvY3Muc2FsZXNmb3JjZS5jb20vZW4tdXMvc3VtbWVyMTYvcmVsZWFzZS1ub3Rlcy9ybl9hcGlfc3RyZWFtaW5nX2NsYXNzaWNfcmVwbGF5Lmh0bVxuICAgIFwiY29tZXRkXCIgKyAobmVlZHNSZXBsYXlGaXggPT09IHRydWUgJiYgdGhpcy5fY29ubi52ZXJzaW9uID09PSBcIjM2LjBcIiA/IFwiL3JlcGxheVwiIDogXCJcIiksXG4gICAgdGhpcy5fY29ubi52ZXJzaW9uXG4gIF0uam9pbignLycpO1xuICB2YXIgZmF5ZUNsaWVudCA9IG5ldyBGYXllLkNsaWVudChlbmRwb2ludFVybCwge1xuICAgIGNvb2tpZXNBbGxvd0FsbFBhdGhzOiB0cnVlXG4gIH0pO1xuICBmYXllQ2xpZW50LnNldEhlYWRlcignQXV0aG9yaXphdGlvbicsICdPQXV0aCAnK3RoaXMuX2Nvbm4uYWNjZXNzVG9rZW4pO1xuICBpZiAoZXh0ZW5zaW9ucyBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgZXh0ZW5zaW9ucy5mb3JFYWNoKGZ1bmN0aW9uKGV4dGVuc2lvbikge1xuICAgICAgZmF5ZUNsaWVudC5hZGRFeHRlbnNpb24oZXh0ZW5zaW9uKTtcbiAgICB9KTtcbiAgfVxuICBpZiAoZmF5ZUNsaWVudC5fZGlzcGF0Y2hlci5nZXRDb25uZWN0aW9uVHlwZXMoKS5pbmRleE9mKCdjYWxsYmFjay1wb2xsaW5nJykgPT09IC0xKSB7XG4gICAgLy8gcHJldmVudCBzdHJlYW1pbmcgQVBJIHNlcnZlciBlcnJvclxuICAgIGZheWVDbGllbnQuX2Rpc3BhdGNoZXIuc2VsZWN0VHJhbnNwb3J0KCdsb25nLXBvbGxpbmcnKTtcbiAgICBmYXllQ2xpZW50Ll9kaXNwYXRjaGVyLl90cmFuc3BvcnQuYmF0Y2hpbmcgPSBmYWxzZTtcbiAgfVxuICByZXR1cm4gZmF5ZUNsaWVudDtcbn07XG5cbi8qKiBAcHJpdmF0ZSAqKi9cblN0cmVhbWluZy5wcm90b3R5cGUuX2dldEZheWVDbGllbnQgPSBmdW5jdGlvbihjaGFubmVsTmFtZSkge1xuICB2YXIgaXNHZW5lcmljID0gY2hhbm5lbE5hbWUuaW5kZXhPZignL3UvJykgPT09IDA7XG4gIHZhciBjbGllbnRUeXBlID0gaXNHZW5lcmljID8gJ2dlbmVyaWMnIDogJ3B1c2hUb3BpYyc7XG4gIGlmICghdGhpcy5fZmF5ZUNsaWVudHMgfHwgIXRoaXMuX2ZheWVDbGllbnRzW2NsaWVudFR5cGVdKSB7XG4gICAgdGhpcy5fZmF5ZUNsaWVudHMgPSB0aGlzLl9mYXllQ2xpZW50cyB8fCB7fTtcbiAgICB0aGlzLl9mYXllQ2xpZW50c1tjbGllbnRUeXBlXSA9IHRoaXMuX2NyZWF0ZUNsaWVudChjaGFubmVsTmFtZSk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2ZheWVDbGllbnRzW2NsaWVudFR5cGVdO1xufTtcblxuXG4vKipcbiAqIEdldCBuYW1lZCB0b3BpY1xuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIC0gVG9waWMgbmFtZVxuICogQHJldHVybnMge1N0cmVhbWluZ35Ub3BpY31cbiAqL1xuU3RyZWFtaW5nLnByb3RvdHlwZS50b3BpYyA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgdGhpcy5fdG9waWNzID0gdGhpcy5fdG9waWNzIHx8IHt9O1xuICB2YXIgdG9waWMgPSB0aGlzLl90b3BpY3NbbmFtZV0gPVxuICAgIHRoaXMuX3RvcGljc1tuYW1lXSB8fCBuZXcgVG9waWModGhpcywgbmFtZSk7XG4gIHJldHVybiB0b3BpYztcbn07XG5cbi8qKlxuICogR2V0IENoYW5uZWwgZm9yIElkXG4gKiBAcGFyYW0ge1N0cmluZ30gY2hhbm5lbElkIC0gSWQgb2YgU3RyZWFtaW5nQ2hhbm5lbCBvYmplY3RcbiAqIEByZXR1cm5zIHtTdHJlYW1pbmd+Q2hhbm5lbH1cbiAqL1xuU3RyZWFtaW5nLnByb3RvdHlwZS5jaGFubmVsID0gZnVuY3Rpb24oY2hhbm5lbElkKSB7XG4gIHJldHVybiBuZXcgQ2hhbm5lbCh0aGlzLCBjaGFubmVsSWQpO1xufTtcblxuLyoqXG4gKiBTdWJzY3JpYmUgdG9waWMvY2hhbm5lbFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIC0gVG9waWMgbmFtZVxuICogQHBhcmFtIHtDYWxsYmFjay48U3RyZWFtaW5nflN0cmVhbWluZ01lc3NhZ2U+fSBsaXN0ZW5lciAtIFN0cmVhbWluZyBtZXNzYWdlIGxpc3RlbmVyXG4gKiBAcmV0dXJucyB7U3Vic2NyaXB0aW9ufSAtIEZheWUgc3Vic2NyaXB0aW9uIG9iamVjdFxuICovXG5TdHJlYW1pbmcucHJvdG90eXBlLnN1YnNjcmliZSA9IGZ1bmN0aW9uKG5hbWUsIGxpc3RlbmVyKSB7XG4gIHZhciBjaGFubmVsTmFtZSA9IG5hbWUuaW5kZXhPZignLycpID09PSAwID8gbmFtZSA6ICcvdG9waWMvJyArIG5hbWU7XG4gIHZhciBmYXllQ2xpZW50ID0gdGhpcy5fZ2V0RmF5ZUNsaWVudChjaGFubmVsTmFtZSk7XG4gIHJldHVybiBmYXllQ2xpZW50LnN1YnNjcmliZShjaGFubmVsTmFtZSwgbGlzdGVuZXIpO1xufTtcblxuLyoqXG4gKiBVbnN1YnNjcmliZSB0b3BpY1xuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIC0gVG9waWMgbmFtZVxuICogQHBhcmFtIHtDYWxsYmFjay48U3RyZWFtaW5nflN0cmVhbWluZ01lc3NhZ2U+fSBsaXN0ZW5lciAtIFN0cmVhbWluZyBtZXNzYWdlIGxpc3RlbmVyXG4gKiBAcmV0dXJucyB7U3RyZWFtaW5nfVxuICovXG5TdHJlYW1pbmcucHJvdG90eXBlLnVuc3Vic2NyaWJlID0gZnVuY3Rpb24obmFtZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGNoYW5uZWxOYW1lID0gbmFtZS5pbmRleE9mKCcvJykgPT09IDAgPyBuYW1lIDogJy90b3BpYy8nICsgbmFtZTtcbiAgdmFyIGZheWVDbGllbnQgPSB0aGlzLl9nZXRGYXllQ2xpZW50KGNoYW5uZWxOYW1lKTtcbiAgZmF5ZUNsaWVudC51bnN1YnNjcmliZShjaGFubmVsTmFtZSwgbGlzdGVuZXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cblxuLyoqXG4gKiBDcmVhdGUgYSBTdHJlYW1pbmcgY2xpZW50LCBvcHRpb25hbGx5IHdpdGggZXh0ZW5zaW9uc1xuICpcbiAqIFNlZSBGYXllIGRvY3MgZm9yIGltcGxlbWVudGF0aW9uIGRldGFpbHM6IGh0dHBzOi8vZmF5ZS5qY29nbGFuLmNvbS9icm93c2VyL2V4dGVuc2lvbnMuaHRtbFxuICpcbiAqIEV4YW1wbGUgdXNhZ2U6XG4gKiBcbiAqIGBgYGphdmFzY3JpcHRcbiAqIC8vIEVzdGFibGlzaCBhIFNhbGVzZm9yY2UgY29ubmVjdGlvbi4gKERldGFpbHMgZWxpZGVkKVxuICogY29uc3QgY29ubiA9IG5ldyBqc2ZvcmNlLkNvbm5lY3Rpb24oeyDigKYgfSk7XG4gKiBcbiAqIGNvbnN0IGZheWVDbGllbnQgPSBjb25uLnN0cmVhbWluZy5jcmVhdGVDbGllbnQoKTtcbiAqIFxuICogY29uc3Qgc3Vic2NyaXB0aW9uID0gZmF5ZUNsaWVudC5zdWJzY3JpYmUoY2hhbm5lbCwgZGF0YSA9PiB7XG4gKiAgIGNvbnNvbGUubG9nKCd0b3BpYyByZWNlaXZlZCBkYXRhJywgZGF0YSk7XG4gKiB9KTtcbiAqIFxuICogc3Vic2NyaXB0aW9uLmNhbmNlbCgpO1xuICogYGBgXG4gKiBcbiAqIEV4YW1wbGUgd2l0aCBleHRlbnNpb25zLCB1c2luZyBSZXBsYXkgJiBBdXRoIEZhaWx1cmUgZXh0ZW5zaW9ucyBpbiBhIHNlcnZlci1zaWRlIE5vZGUuanMgYXBwOlxuICogXG4gKiBgYGBqYXZhc2NyaXB0XG4gKiAvLyBFc3RhYmxpc2ggYSBTYWxlc2ZvcmNlIGNvbm5lY3Rpb24uIChEZXRhaWxzIGVsaWRlZClcbiAqIGNvbnN0IGNvbm4gPSBuZXcganNmb3JjZS5Db25uZWN0aW9uKHsg4oCmIH0pO1xuICogXG4gKiBjb25zdCBjaGFubmVsID0gXCIvZXZlbnQvTXlfRXZlbnRfX2VcIjtcbiAqIGNvbnN0IHJlcGxheUlkID0gLTI7IC8vIC0yIGlzIGFsbCByZXRhaW5lZCBldmVudHNcbiAqIFxuICogY29uc3QgZXhpdENhbGxiYWNrID0gKCkgPT4gcHJvY2Vzcy5leGl0KDEpO1xuICogY29uc3QgYXV0aEZhaWx1cmVFeHQgPSBuZXcganNmb3JjZS5TdHJlYW1pbmdFeHRlbnNpb24uQXV0aEZhaWx1cmUoZXhpdENhbGxiYWNrKTtcbiAqIFxuICogY29uc3QgcmVwbGF5RXh0ID0gbmV3IGpzZm9yY2UuU3RyZWFtaW5nRXh0ZW5zaW9uLlJlcGxheShjaGFubmVsLCByZXBsYXlJZCk7XG4gKiBcbiAqIGNvbnN0IGZheWVDbGllbnQgPSBjb25uLnN0cmVhbWluZy5jcmVhdGVDbGllbnQoW1xuICogICBhdXRoRmFpbHVyZUV4dCxcbiAqICAgcmVwbGF5RXh0XG4gKiBdKTtcbiAqIFxuICogY29uc3Qgc3Vic2NyaXB0aW9uID0gZmF5ZUNsaWVudC5zdWJzY3JpYmUoY2hhbm5lbCwgZGF0YSA9PiB7XG4gKiAgIGNvbnNvbGUubG9nKCd0b3BpYyByZWNlaXZlZCBkYXRhJywgZGF0YSk7XG4gKiB9KTtcbiAqIFxuICogc3Vic2NyaXB0aW9uLmNhbmNlbCgpO1xuICogYGBgXG4gKiBcbiAqIEBwYXJhbSB7QXJyYXl9IEV4dGVuc2lvbnMgLSBPcHRpb25hbCwgZXh0ZW5zaW9ucyB0byBhcHBseSB0byB0aGUgRmF5ZSBjbGllbnRcbiAqIEByZXR1cm5zIHtGYXllQ2xpZW50fSAtIEZheWUgY2xpZW50IG9iamVjdFxuICovXG5TdHJlYW1pbmcucHJvdG90eXBlLmNyZWF0ZUNsaWVudCA9IGZ1bmN0aW9uKGV4dGVuc2lvbnMpIHtcbiAgcmV0dXJuIHRoaXMuX2NyZWF0ZUNsaWVudChudWxsLCBleHRlbnNpb25zKTtcbn07XG5cbi8qLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0qL1xuLypcbiAqIFJlZ2lzdGVyIGhvb2sgaW4gY29ubmVjdGlvbiBpbnN0YW50aWF0aW9uIGZvciBkeW5hbWljYWxseSBhZGRpbmcgdGhpcyBBUEkgbW9kdWxlIGZlYXR1cmVzXG4gKi9cbmpzZm9yY2Uub24oJ2Nvbm5lY3Rpb246bmV3JywgZnVuY3Rpb24oY29ubikge1xuICBjb25uLnN0cmVhbWluZyA9IG5ldyBTdHJlYW1pbmcoY29ubik7XG59KTtcblxuLypcbiAqIFxuICovXG5qc2ZvcmNlLlN0cmVhbWluZ0V4dGVuc2lvbiA9IFN0cmVhbWluZ0V4dGVuc2lvbjtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJlYW1pbmc7XG4iLCJcInVzZSBzdHJpY3RcIjtcblxuLy8gcmF3QXNhcCBwcm92aWRlcyBldmVyeXRoaW5nIHdlIG5lZWQgZXhjZXB0IGV4Y2VwdGlvbiBtYW5hZ2VtZW50LlxudmFyIHJhd0FzYXAgPSByZXF1aXJlKFwiLi9yYXdcIik7XG4vLyBSYXdUYXNrcyBhcmUgcmVjeWNsZWQgdG8gcmVkdWNlIEdDIGNodXJuLlxudmFyIGZyZWVUYXNrcyA9IFtdO1xuLy8gV2UgcXVldWUgZXJyb3JzIHRvIGVuc3VyZSB0aGV5IGFyZSB0aHJvd24gaW4gcmlnaHQgb3JkZXIgKEZJRk8pLlxuLy8gQXJyYXktYXMtcXVldWUgaXMgZ29vZCBlbm91Z2ggaGVyZSwgc2luY2Ugd2UgYXJlIGp1c3QgZGVhbGluZyB3aXRoIGV4Y2VwdGlvbnMuXG52YXIgcGVuZGluZ0Vycm9ycyA9IFtdO1xudmFyIHJlcXVlc3RFcnJvclRocm93ID0gcmF3QXNhcC5tYWtlUmVxdWVzdENhbGxGcm9tVGltZXIodGhyb3dGaXJzdEVycm9yKTtcblxuZnVuY3Rpb24gdGhyb3dGaXJzdEVycm9yKCkge1xuICAgIGlmIChwZW5kaW5nRXJyb3JzLmxlbmd0aCkge1xuICAgICAgICB0aHJvdyBwZW5kaW5nRXJyb3JzLnNoaWZ0KCk7XG4gICAgfVxufVxuXG4vKipcbiAqIENhbGxzIGEgdGFzayBhcyBzb29uIGFzIHBvc3NpYmxlIGFmdGVyIHJldHVybmluZywgaW4gaXRzIG93biBldmVudCwgd2l0aCBwcmlvcml0eVxuICogb3ZlciBvdGhlciBldmVudHMgbGlrZSBhbmltYXRpb24sIHJlZmxvdywgYW5kIHJlcGFpbnQuIEFuIGVycm9yIHRocm93biBmcm9tIGFuXG4gKiBldmVudCB3aWxsIG5vdCBpbnRlcnJ1cHQsIG5vciBldmVuIHN1YnN0YW50aWFsbHkgc2xvdyBkb3duIHRoZSBwcm9jZXNzaW5nIG9mXG4gKiBvdGhlciBldmVudHMsIGJ1dCB3aWxsIGJlIHJhdGhlciBwb3N0cG9uZWQgdG8gYSBsb3dlciBwcmlvcml0eSBldmVudC5cbiAqIEBwYXJhbSB7e2NhbGx9fSB0YXNrIEEgY2FsbGFibGUgb2JqZWN0LCB0eXBpY2FsbHkgYSBmdW5jdGlvbiB0aGF0IHRha2VzIG5vXG4gKiBhcmd1bWVudHMuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gYXNhcDtcbmZ1bmN0aW9uIGFzYXAodGFzaykge1xuICAgIHZhciByYXdUYXNrO1xuICAgIGlmIChmcmVlVGFza3MubGVuZ3RoKSB7XG4gICAgICAgIHJhd1Rhc2sgPSBmcmVlVGFza3MucG9wKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcmF3VGFzayA9IG5ldyBSYXdUYXNrKCk7XG4gICAgfVxuICAgIHJhd1Rhc2sudGFzayA9IHRhc2s7XG4gICAgcmF3QXNhcChyYXdUYXNrKTtcbn1cblxuLy8gV2Ugd3JhcCB0YXNrcyB3aXRoIHJlY3ljbGFibGUgdGFzayBvYmplY3RzLiAgQSB0YXNrIG9iamVjdCBpbXBsZW1lbnRzXG4vLyBgY2FsbGAsIGp1c3QgbGlrZSBhIGZ1bmN0aW9uLlxuZnVuY3Rpb24gUmF3VGFzaygpIHtcbiAgICB0aGlzLnRhc2sgPSBudWxsO1xufVxuXG4vLyBUaGUgc29sZSBwdXJwb3NlIG9mIHdyYXBwaW5nIHRoZSB0YXNrIGlzIHRvIGNhdGNoIHRoZSBleGNlcHRpb24gYW5kIHJlY3ljbGVcbi8vIHRoZSB0YXNrIG9iamVjdCBhZnRlciBpdHMgc2luZ2xlIHVzZS5cblJhd1Rhc2sucHJvdG90eXBlLmNhbGwgPSBmdW5jdGlvbiAoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgdGhpcy50YXNrLmNhbGwoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBpZiAoYXNhcC5vbmVycm9yKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGhvb2sgZXhpc3RzIHB1cmVseSBmb3IgdGVzdGluZyBwdXJwb3Nlcy5cbiAgICAgICAgICAgIC8vIEl0cyBuYW1lIHdpbGwgYmUgcGVyaW9kaWNhbGx5IHJhbmRvbWl6ZWQgdG8gYnJlYWsgYW55IGNvZGUgdGhhdFxuICAgICAgICAgICAgLy8gZGVwZW5kcyBvbiBpdHMgZXhpc3RlbmNlLlxuICAgICAgICAgICAgYXNhcC5vbmVycm9yKGVycm9yKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIEluIGEgd2ViIGJyb3dzZXIsIGV4Y2VwdGlvbnMgYXJlIG5vdCBmYXRhbC4gSG93ZXZlciwgdG8gYXZvaWRcbiAgICAgICAgICAgIC8vIHNsb3dpbmcgZG93biB0aGUgcXVldWUgb2YgcGVuZGluZyB0YXNrcywgd2UgcmV0aHJvdyB0aGUgZXJyb3IgaW4gYVxuICAgICAgICAgICAgLy8gbG93ZXIgcHJpb3JpdHkgdHVybi5cbiAgICAgICAgICAgIHBlbmRpbmdFcnJvcnMucHVzaChlcnJvcik7XG4gICAgICAgICAgICByZXF1ZXN0RXJyb3JUaHJvdygpO1xuICAgICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgICAgdGhpcy50YXNrID0gbnVsbDtcbiAgICAgICAgZnJlZVRhc2tzW2ZyZWVUYXNrcy5sZW5ndGhdID0gdGhpcztcbiAgICB9XG59O1xuIiwiXCJ1c2Ugc3RyaWN0XCI7XG5cbi8vIFVzZSB0aGUgZmFzdGVzdCBtZWFucyBwb3NzaWJsZSB0byBleGVjdXRlIGEgdGFzayBpbiBpdHMgb3duIHR1cm4sIHdpdGhcbi8vIHByaW9yaXR5IG92ZXIgb3RoZXIgZXZlbnRzIGluY2x1ZGluZyBJTywgYW5pbWF0aW9uLCByZWZsb3csIGFuZCByZWRyYXdcbi8vIGV2ZW50cyBpbiBicm93c2Vycy5cbi8vXG4vLyBBbiBleGNlcHRpb24gdGhyb3duIGJ5IGEgdGFzayB3aWxsIHBlcm1hbmVudGx5IGludGVycnVwdCB0aGUgcHJvY2Vzc2luZyBvZlxuLy8gc3Vic2VxdWVudCB0YXNrcy4gVGhlIGhpZ2hlciBsZXZlbCBgYXNhcGAgZnVuY3Rpb24gZW5zdXJlcyB0aGF0IGlmIGFuXG4vLyBleGNlcHRpb24gaXMgdGhyb3duIGJ5IGEgdGFzaywgdGhhdCB0aGUgdGFzayBxdWV1ZSB3aWxsIGNvbnRpbnVlIGZsdXNoaW5nIGFzXG4vLyBzb29uIGFzIHBvc3NpYmxlLCBidXQgaWYgeW91IHVzZSBgcmF3QXNhcGAgZGlyZWN0bHksIHlvdSBhcmUgcmVzcG9uc2libGUgdG9cbi8vIGVpdGhlciBlbnN1cmUgdGhhdCBubyBleGNlcHRpb25zIGFyZSB0aHJvd24gZnJvbSB5b3VyIHRhc2ssIG9yIHRvIG1hbnVhbGx5XG4vLyBjYWxsIGByYXdBc2FwLnJlcXVlc3RGbHVzaGAgaWYgYW4gZXhjZXB0aW9uIGlzIHRocm93bi5cbm1vZHVsZS5leHBvcnRzID0gcmF3QXNhcDtcbmZ1bmN0aW9uIHJhd0FzYXAodGFzaykge1xuICAgIGlmICghcXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHJlcXVlc3RGbHVzaCgpO1xuICAgICAgICBmbHVzaGluZyA9IHRydWU7XG4gICAgfVxuICAgIC8vIEVxdWl2YWxlbnQgdG8gcHVzaCwgYnV0IGF2b2lkcyBhIGZ1bmN0aW9uIGNhbGwuXG4gICAgcXVldWVbcXVldWUubGVuZ3RoXSA9IHRhc2s7XG59XG5cbnZhciBxdWV1ZSA9IFtdO1xuLy8gT25jZSBhIGZsdXNoIGhhcyBiZWVuIHJlcXVlc3RlZCwgbm8gZnVydGhlciBjYWxscyB0byBgcmVxdWVzdEZsdXNoYCBhcmVcbi8vIG5lY2Vzc2FyeSB1bnRpbCB0aGUgbmV4dCBgZmx1c2hgIGNvbXBsZXRlcy5cbnZhciBmbHVzaGluZyA9IGZhbHNlO1xuLy8gYHJlcXVlc3RGbHVzaGAgaXMgYW4gaW1wbGVtZW50YXRpb24tc3BlY2lmaWMgbWV0aG9kIHRoYXQgYXR0ZW1wdHMgdG8ga2lja1xuLy8gb2ZmIGEgYGZsdXNoYCBldmVudCBhcyBxdWlja2x5IGFzIHBvc3NpYmxlLiBgZmx1c2hgIHdpbGwgYXR0ZW1wdCB0byBleGhhdXN0XG4vLyB0aGUgZXZlbnQgcXVldWUgYmVmb3JlIHlpZWxkaW5nIHRvIHRoZSBicm93c2VyJ3Mgb3duIGV2ZW50IGxvb3AuXG52YXIgcmVxdWVzdEZsdXNoO1xuLy8gVGhlIHBvc2l0aW9uIG9mIHRoZSBuZXh0IHRhc2sgdG8gZXhlY3V0ZSBpbiB0aGUgdGFzayBxdWV1ZS4gVGhpcyBpc1xuLy8gcHJlc2VydmVkIGJldHdlZW4gY2FsbHMgdG8gYGZsdXNoYCBzbyB0aGF0IGl0IGNhbiBiZSByZXN1bWVkIGlmXG4vLyBhIHRhc2sgdGhyb3dzIGFuIGV4Y2VwdGlvbi5cbnZhciBpbmRleCA9IDA7XG4vLyBJZiBhIHRhc2sgc2NoZWR1bGVzIGFkZGl0aW9uYWwgdGFza3MgcmVjdXJzaXZlbHksIHRoZSB0YXNrIHF1ZXVlIGNhbiBncm93XG4vLyB1bmJvdW5kZWQuIFRvIHByZXZlbnQgbWVtb3J5IGV4aGF1c3Rpb24sIHRoZSB0YXNrIHF1ZXVlIHdpbGwgcGVyaW9kaWNhbGx5XG4vLyB0cnVuY2F0ZSBhbHJlYWR5LWNvbXBsZXRlZCB0YXNrcy5cbnZhciBjYXBhY2l0eSA9IDEwMjQ7XG5cbi8vIFRoZSBmbHVzaCBmdW5jdGlvbiBwcm9jZXNzZXMgYWxsIHRhc2tzIHRoYXQgaGF2ZSBiZWVuIHNjaGVkdWxlZCB3aXRoXG4vLyBgcmF3QXNhcGAgdW5sZXNzIGFuZCB1bnRpbCBvbmUgb2YgdGhvc2UgdGFza3MgdGhyb3dzIGFuIGV4Y2VwdGlvbi5cbi8vIElmIGEgdGFzayB0aHJvd3MgYW4gZXhjZXB0aW9uLCBgZmx1c2hgIGVuc3VyZXMgdGhhdCBpdHMgc3RhdGUgd2lsbCByZW1haW5cbi8vIGNvbnNpc3RlbnQgYW5kIHdpbGwgcmVzdW1lIHdoZXJlIGl0IGxlZnQgb2ZmIHdoZW4gY2FsbGVkIGFnYWluLlxuLy8gSG93ZXZlciwgYGZsdXNoYCBkb2VzIG5vdCBtYWtlIGFueSBhcnJhbmdlbWVudHMgdG8gYmUgY2FsbGVkIGFnYWluIGlmIGFuXG4vLyBleGNlcHRpb24gaXMgdGhyb3duLlxuZnVuY3Rpb24gZmx1c2goKSB7XG4gICAgd2hpbGUgKGluZGV4IDwgcXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHZhciBjdXJyZW50SW5kZXggPSBpbmRleDtcbiAgICAgICAgLy8gQWR2YW5jZSB0aGUgaW5kZXggYmVmb3JlIGNhbGxpbmcgdGhlIHRhc2suIFRoaXMgZW5zdXJlcyB0aGF0IHdlIHdpbGxcbiAgICAgICAgLy8gYmVnaW4gZmx1c2hpbmcgb24gdGhlIG5leHQgdGFzayB0aGUgdGFzayB0aHJvd3MgYW4gZXJyb3IuXG4gICAgICAgIGluZGV4ID0gaW5kZXggKyAxO1xuICAgICAgICBxdWV1ZVtjdXJyZW50SW5kZXhdLmNhbGwoKTtcbiAgICAgICAgLy8gUHJldmVudCBsZWFraW5nIG1lbW9yeSBmb3IgbG9uZyBjaGFpbnMgb2YgcmVjdXJzaXZlIGNhbGxzIHRvIGBhc2FwYC5cbiAgICAgICAgLy8gSWYgd2UgY2FsbCBgYXNhcGAgd2l0aGluIHRhc2tzIHNjaGVkdWxlZCBieSBgYXNhcGAsIHRoZSBxdWV1ZSB3aWxsXG4gICAgICAgIC8vIGdyb3csIGJ1dCB0byBhdm9pZCBhbiBPKG4pIHdhbGsgZm9yIGV2ZXJ5IHRhc2sgd2UgZXhlY3V0ZSwgd2UgZG9uJ3RcbiAgICAgICAgLy8gc2hpZnQgdGFza3Mgb2ZmIHRoZSBxdWV1ZSBhZnRlciB0aGV5IGhhdmUgYmVlbiBleGVjdXRlZC5cbiAgICAgICAgLy8gSW5zdGVhZCwgd2UgcGVyaW9kaWNhbGx5IHNoaWZ0IDEwMjQgdGFza3Mgb2ZmIHRoZSBxdWV1ZS5cbiAgICAgICAgaWYgKGluZGV4ID4gY2FwYWNpdHkpIHtcbiAgICAgICAgICAgIC8vIE1hbnVhbGx5IHNoaWZ0IGFsbCB2YWx1ZXMgc3RhcnRpbmcgYXQgdGhlIGluZGV4IGJhY2sgdG8gdGhlXG4gICAgICAgICAgICAvLyBiZWdpbm5pbmcgb2YgdGhlIHF1ZXVlLlxuICAgICAgICAgICAgZm9yICh2YXIgc2NhbiA9IDAsIG5ld0xlbmd0aCA9IHF1ZXVlLmxlbmd0aCAtIGluZGV4OyBzY2FuIDwgbmV3TGVuZ3RoOyBzY2FuKyspIHtcbiAgICAgICAgICAgICAgICBxdWV1ZVtzY2FuXSA9IHF1ZXVlW3NjYW4gKyBpbmRleF07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBxdWV1ZS5sZW5ndGggLT0gaW5kZXg7XG4gICAgICAgICAgICBpbmRleCA9IDA7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUubGVuZ3RoID0gMDtcbiAgICBpbmRleCA9IDA7XG4gICAgZmx1c2hpbmcgPSBmYWxzZTtcbn1cblxuLy8gYHJlcXVlc3RGbHVzaGAgaXMgaW1wbGVtZW50ZWQgdXNpbmcgYSBzdHJhdGVneSBiYXNlZCBvbiBkYXRhIGNvbGxlY3RlZCBmcm9tXG4vLyBldmVyeSBhdmFpbGFibGUgU2F1Y2VMYWJzIFNlbGVuaXVtIHdlYiBkcml2ZXIgd29ya2VyIGF0IHRpbWUgb2Ygd3JpdGluZy5cbi8vIGh0dHBzOi8vZG9jcy5nb29nbGUuY29tL3NwcmVhZHNoZWV0cy9kLzFtRy01VVlHdXA1cXhHZEVNV2toUDZCV0N6MDUzTlViMkUxUW9VVFUxNnVBL2VkaXQjZ2lkPTc4MzcyNDU5M1xuXG4vLyBTYWZhcmkgNiBhbmQgNi4xIGZvciBkZXNrdG9wLCBpUGFkLCBhbmQgaVBob25lIGFyZSB0aGUgb25seSBicm93c2VycyB0aGF0XG4vLyBoYXZlIFdlYktpdE11dGF0aW9uT2JzZXJ2ZXIgYnV0IG5vdCB1bi1wcmVmaXhlZCBNdXRhdGlvbk9ic2VydmVyLlxuLy8gTXVzdCB1c2UgYGdsb2JhbGAgb3IgYHNlbGZgIGluc3RlYWQgb2YgYHdpbmRvd2AgdG8gd29yayBpbiBib3RoIGZyYW1lcyBhbmQgd2ViXG4vLyB3b3JrZXJzLiBgZ2xvYmFsYCBpcyBhIHByb3Zpc2lvbiBvZiBCcm93c2VyaWZ5LCBNciwgTXJzLCBvciBNb3AuXG5cbi8qIGdsb2JhbHMgc2VsZiAqL1xudmFyIHNjb3BlID0gdHlwZW9mIGdsb2JhbCAhPT0gXCJ1bmRlZmluZWRcIiA/IGdsb2JhbCA6IHNlbGY7XG52YXIgQnJvd3Nlck11dGF0aW9uT2JzZXJ2ZXIgPSBzY29wZS5NdXRhdGlvbk9ic2VydmVyIHx8IHNjb3BlLldlYktpdE11dGF0aW9uT2JzZXJ2ZXI7XG5cbi8vIE11dGF0aW9uT2JzZXJ2ZXJzIGFyZSBkZXNpcmFibGUgYmVjYXVzZSB0aGV5IGhhdmUgaGlnaCBwcmlvcml0eSBhbmQgd29ya1xuLy8gcmVsaWFibHkgZXZlcnl3aGVyZSB0aGV5IGFyZSBpbXBsZW1lbnRlZC5cbi8vIFRoZXkgYXJlIGltcGxlbWVudGVkIGluIGFsbCBtb2Rlcm4gYnJvd3NlcnMuXG4vL1xuLy8gLSBBbmRyb2lkIDQtNC4zXG4vLyAtIENocm9tZSAyNi0zNFxuLy8gLSBGaXJlZm94IDE0LTI5XG4vLyAtIEludGVybmV0IEV4cGxvcmVyIDExXG4vLyAtIGlQYWQgU2FmYXJpIDYtNy4xXG4vLyAtIGlQaG9uZSBTYWZhcmkgNy03LjFcbi8vIC0gU2FmYXJpIDYtN1xuaWYgKHR5cGVvZiBCcm93c2VyTXV0YXRpb25PYnNlcnZlciA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgcmVxdWVzdEZsdXNoID0gbWFrZVJlcXVlc3RDYWxsRnJvbU11dGF0aW9uT2JzZXJ2ZXIoZmx1c2gpO1xuXG4vLyBNZXNzYWdlQ2hhbm5lbHMgYXJlIGRlc2lyYWJsZSBiZWNhdXNlIHRoZXkgZ2l2ZSBkaXJlY3QgYWNjZXNzIHRvIHRoZSBIVE1MXG4vLyB0YXNrIHF1ZXVlLCBhcmUgaW1wbGVtZW50ZWQgaW4gSW50ZXJuZXQgRXhwbG9yZXIgMTAsIFNhZmFyaSA1LjAtMSwgYW5kIE9wZXJhXG4vLyAxMS0xMiwgYW5kIGluIHdlYiB3b3JrZXJzIGluIG1hbnkgZW5naW5lcy5cbi8vIEFsdGhvdWdoIG1lc3NhZ2UgY2hhbm5lbHMgeWllbGQgdG8gYW55IHF1ZXVlZCByZW5kZXJpbmcgYW5kIElPIHRhc2tzLCB0aGV5XG4vLyB3b3VsZCBiZSBiZXR0ZXIgdGhhbiBpbXBvc2luZyB0aGUgNG1zIGRlbGF5IG9mIHRpbWVycy5cbi8vIEhvd2V2ZXIsIHRoZXkgZG8gbm90IHdvcmsgcmVsaWFibHkgaW4gSW50ZXJuZXQgRXhwbG9yZXIgb3IgU2FmYXJpLlxuXG4vLyBJbnRlcm5ldCBFeHBsb3JlciAxMCBpcyB0aGUgb25seSBicm93c2VyIHRoYXQgaGFzIHNldEltbWVkaWF0ZSBidXQgZG9lc1xuLy8gbm90IGhhdmUgTXV0YXRpb25PYnNlcnZlcnMuXG4vLyBBbHRob3VnaCBzZXRJbW1lZGlhdGUgeWllbGRzIHRvIHRoZSBicm93c2VyJ3MgcmVuZGVyZXIsIGl0IHdvdWxkIGJlXG4vLyBwcmVmZXJyYWJsZSB0byBmYWxsaW5nIGJhY2sgdG8gc2V0VGltZW91dCBzaW5jZSBpdCBkb2VzIG5vdCBoYXZlXG4vLyB0aGUgbWluaW11bSA0bXMgcGVuYWx0eS5cbi8vIFVuZm9ydHVuYXRlbHkgdGhlcmUgYXBwZWFycyB0byBiZSBhIGJ1ZyBpbiBJbnRlcm5ldCBFeHBsb3JlciAxMCBNb2JpbGUgKGFuZFxuLy8gRGVza3RvcCB0byBhIGxlc3NlciBleHRlbnQpIHRoYXQgcmVuZGVycyBib3RoIHNldEltbWVkaWF0ZSBhbmRcbi8vIE1lc3NhZ2VDaGFubmVsIHVzZWxlc3MgZm9yIHRoZSBwdXJwb3NlcyBvZiBBU0FQLlxuLy8gaHR0cHM6Ly9naXRodWIuY29tL2tyaXNrb3dhbC9xL2lzc3Vlcy8zOTZcblxuLy8gVGltZXJzIGFyZSBpbXBsZW1lbnRlZCB1bml2ZXJzYWxseS5cbi8vIFdlIGZhbGwgYmFjayB0byB0aW1lcnMgaW4gd29ya2VycyBpbiBtb3N0IGVuZ2luZXMsIGFuZCBpbiBmb3JlZ3JvdW5kXG4vLyBjb250ZXh0cyBpbiB0aGUgZm9sbG93aW5nIGJyb3dzZXJzLlxuLy8gSG93ZXZlciwgbm90ZSB0aGF0IGV2ZW4gdGhpcyBzaW1wbGUgY2FzZSByZXF1aXJlcyBudWFuY2VzIHRvIG9wZXJhdGUgaW4gYVxuLy8gYnJvYWQgc3BlY3RydW0gb2YgYnJvd3NlcnMuXG4vL1xuLy8gLSBGaXJlZm94IDMtMTNcbi8vIC0gSW50ZXJuZXQgRXhwbG9yZXIgNi05XG4vLyAtIGlQYWQgU2FmYXJpIDQuM1xuLy8gLSBMeW54IDIuOC43XG59IGVsc2Uge1xuICAgIHJlcXVlc3RGbHVzaCA9IG1ha2VSZXF1ZXN0Q2FsbEZyb21UaW1lcihmbHVzaCk7XG59XG5cbi8vIGByZXF1ZXN0Rmx1c2hgIHJlcXVlc3RzIHRoYXQgdGhlIGhpZ2ggcHJpb3JpdHkgZXZlbnQgcXVldWUgYmUgZmx1c2hlZCBhc1xuLy8gc29vbiBhcyBwb3NzaWJsZS5cbi8vIFRoaXMgaXMgdXNlZnVsIHRvIHByZXZlbnQgYW4gZXJyb3IgdGhyb3duIGluIGEgdGFzayBmcm9tIHN0YWxsaW5nIHRoZSBldmVudFxuLy8gcXVldWUgaWYgdGhlIGV4Y2VwdGlvbiBoYW5kbGVkIGJ5IE5vZGUuanPigJlzXG4vLyBgcHJvY2Vzcy5vbihcInVuY2F1Z2h0RXhjZXB0aW9uXCIpYCBvciBieSBhIGRvbWFpbi5cbnJhd0FzYXAucmVxdWVzdEZsdXNoID0gcmVxdWVzdEZsdXNoO1xuXG4vLyBUbyByZXF1ZXN0IGEgaGlnaCBwcmlvcml0eSBldmVudCwgd2UgaW5kdWNlIGEgbXV0YXRpb24gb2JzZXJ2ZXIgYnkgdG9nZ2xpbmdcbi8vIHRoZSB0ZXh0IG9mIGEgdGV4dCBub2RlIGJldHdlZW4gXCIxXCIgYW5kIFwiLTFcIi5cbmZ1bmN0aW9uIG1ha2VSZXF1ZXN0Q2FsbEZyb21NdXRhdGlvbk9ic2VydmVyKGNhbGxiYWNrKSB7XG4gICAgdmFyIHRvZ2dsZSA9IDE7XG4gICAgdmFyIG9ic2VydmVyID0gbmV3IEJyb3dzZXJNdXRhdGlvbk9ic2VydmVyKGNhbGxiYWNrKTtcbiAgICB2YXIgbm9kZSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKFwiXCIpO1xuICAgIG9ic2VydmVyLm9ic2VydmUobm9kZSwge2NoYXJhY3RlckRhdGE6IHRydWV9KTtcbiAgICByZXR1cm4gZnVuY3Rpb24gcmVxdWVzdENhbGwoKSB7XG4gICAgICAgIHRvZ2dsZSA9IC10b2dnbGU7XG4gICAgICAgIG5vZGUuZGF0YSA9IHRvZ2dsZTtcbiAgICB9O1xufVxuXG4vLyBUaGUgbWVzc2FnZSBjaGFubmVsIHRlY2huaXF1ZSB3YXMgZGlzY292ZXJlZCBieSBNYWx0ZSBVYmwgYW5kIHdhcyB0aGVcbi8vIG9yaWdpbmFsIGZvdW5kYXRpb24gZm9yIHRoaXMgbGlicmFyeS5cbi8vIGh0dHA6Ly93d3cubm9uYmxvY2tpbmcuaW8vMjAxMS8wNi93aW5kb3duZXh0dGljay5odG1sXG5cbi8vIFNhZmFyaSA2LjAuNSAoYXQgbGVhc3QpIGludGVybWl0dGVudGx5IGZhaWxzIHRvIGNyZWF0ZSBtZXNzYWdlIHBvcnRzIG9uIGFcbi8vIHBhZ2UncyBmaXJzdCBsb2FkLiBUaGFua2Z1bGx5LCB0aGlzIHZlcnNpb24gb2YgU2FmYXJpIHN1cHBvcnRzXG4vLyBNdXRhdGlvbk9ic2VydmVycywgc28gd2UgZG9uJ3QgbmVlZCB0byBmYWxsIGJhY2sgaW4gdGhhdCBjYXNlLlxuXG4vLyBmdW5jdGlvbiBtYWtlUmVxdWVzdENhbGxGcm9tTWVzc2FnZUNoYW5uZWwoY2FsbGJhY2spIHtcbi8vICAgICB2YXIgY2hhbm5lbCA9IG5ldyBNZXNzYWdlQ2hhbm5lbCgpO1xuLy8gICAgIGNoYW5uZWwucG9ydDEub25tZXNzYWdlID0gY2FsbGJhY2s7XG4vLyAgICAgcmV0dXJuIGZ1bmN0aW9uIHJlcXVlc3RDYWxsKCkge1xuLy8gICAgICAgICBjaGFubmVsLnBvcnQyLnBvc3RNZXNzYWdlKDApO1xuLy8gICAgIH07XG4vLyB9XG5cbi8vIEZvciByZWFzb25zIGV4cGxhaW5lZCBhYm92ZSwgd2UgYXJlIGFsc28gdW5hYmxlIHRvIHVzZSBgc2V0SW1tZWRpYXRlYFxuLy8gdW5kZXIgYW55IGNpcmN1bXN0YW5jZXMuXG4vLyBFdmVuIGlmIHdlIHdlcmUsIHRoZXJlIGlzIGFub3RoZXIgYnVnIGluIEludGVybmV0IEV4cGxvcmVyIDEwLlxuLy8gSXQgaXMgbm90IHN1ZmZpY2llbnQgdG8gYXNzaWduIGBzZXRJbW1lZGlhdGVgIHRvIGByZXF1ZXN0Rmx1c2hgIGJlY2F1c2Vcbi8vIGBzZXRJbW1lZGlhdGVgIG11c3QgYmUgY2FsbGVkICpieSBuYW1lKiBhbmQgdGhlcmVmb3JlIG11c3QgYmUgd3JhcHBlZCBpbiBhXG4vLyBjbG9zdXJlLlxuLy8gTmV2ZXIgZm9yZ2V0LlxuXG4vLyBmdW5jdGlvbiBtYWtlUmVxdWVzdENhbGxGcm9tU2V0SW1tZWRpYXRlKGNhbGxiYWNrKSB7XG4vLyAgICAgcmV0dXJuIGZ1bmN0aW9uIHJlcXVlc3RDYWxsKCkge1xuLy8gICAgICAgICBzZXRJbW1lZGlhdGUoY2FsbGJhY2spO1xuLy8gICAgIH07XG4vLyB9XG5cbi8vIFNhZmFyaSA2LjAgaGFzIGEgcHJvYmxlbSB3aGVyZSB0aW1lcnMgd2lsbCBnZXQgbG9zdCB3aGlsZSB0aGUgdXNlciBpc1xuLy8gc2Nyb2xsaW5nLiBUaGlzIHByb2JsZW0gZG9lcyBub3QgaW1wYWN0IEFTQVAgYmVjYXVzZSBTYWZhcmkgNi4wIHN1cHBvcnRzXG4vLyBtdXRhdGlvbiBvYnNlcnZlcnMsIHNvIHRoYXQgaW1wbGVtZW50YXRpb24gaXMgdXNlZCBpbnN0ZWFkLlxuLy8gSG93ZXZlciwgaWYgd2UgZXZlciBlbGVjdCB0byB1c2UgdGltZXJzIGluIFNhZmFyaSwgdGhlIHByZXZhbGVudCB3b3JrLWFyb3VuZFxuLy8gaXMgdG8gYWRkIGEgc2Nyb2xsIGV2ZW50IGxpc3RlbmVyIHRoYXQgY2FsbHMgZm9yIGEgZmx1c2guXG5cbi8vIGBzZXRUaW1lb3V0YCBkb2VzIG5vdCBjYWxsIHRoZSBwYXNzZWQgY2FsbGJhY2sgaWYgdGhlIGRlbGF5IGlzIGxlc3MgdGhhblxuLy8gYXBwcm94aW1hdGVseSA3IGluIHdlYiB3b3JrZXJzIGluIEZpcmVmb3ggOCB0aHJvdWdoIDE4LCBhbmQgc29tZXRpbWVzIG5vdFxuLy8gZXZlbiB0aGVuLlxuXG5mdW5jdGlvbiBtYWtlUmVxdWVzdENhbGxGcm9tVGltZXIoY2FsbGJhY2spIHtcbiAgICByZXR1cm4gZnVuY3Rpb24gcmVxdWVzdENhbGwoKSB7XG4gICAgICAgIC8vIFdlIGRpc3BhdGNoIGEgdGltZW91dCB3aXRoIGEgc3BlY2lmaWVkIGRlbGF5IG9mIDAgZm9yIGVuZ2luZXMgdGhhdFxuICAgICAgICAvLyBjYW4gcmVsaWFibHkgYWNjb21tb2RhdGUgdGhhdCByZXF1ZXN0LiBUaGlzIHdpbGwgdXN1YWxseSBiZSBzbmFwcGVkXG4gICAgICAgIC8vIHRvIGEgNCBtaWxpc2Vjb25kIGRlbGF5LCBidXQgb25jZSB3ZSdyZSBmbHVzaGluZywgdGhlcmUncyBubyBkZWxheVxuICAgICAgICAvLyBiZXR3ZWVuIGV2ZW50cy5cbiAgICAgICAgdmFyIHRpbWVvdXRIYW5kbGUgPSBzZXRUaW1lb3V0KGhhbmRsZVRpbWVyLCAwKTtcbiAgICAgICAgLy8gSG93ZXZlciwgc2luY2UgdGhpcyB0aW1lciBnZXRzIGZyZXF1ZW50bHkgZHJvcHBlZCBpbiBGaXJlZm94XG4gICAgICAgIC8vIHdvcmtlcnMsIHdlIGVubGlzdCBhbiBpbnRlcnZhbCBoYW5kbGUgdGhhdCB3aWxsIHRyeSB0byBmaXJlXG4gICAgICAgIC8vIGFuIGV2ZW50IDIwIHRpbWVzIHBlciBzZWNvbmQgdW50aWwgaXQgc3VjY2VlZHMuXG4gICAgICAgIHZhciBpbnRlcnZhbEhhbmRsZSA9IHNldEludGVydmFsKGhhbmRsZVRpbWVyLCA1MCk7XG5cbiAgICAgICAgZnVuY3Rpb24gaGFuZGxlVGltZXIoKSB7XG4gICAgICAgICAgICAvLyBXaGljaGV2ZXIgdGltZXIgc3VjY2VlZHMgd2lsbCBjYW5jZWwgYm90aCB0aW1lcnMgYW5kXG4gICAgICAgICAgICAvLyBleGVjdXRlIHRoZSBjYWxsYmFjay5cbiAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aW1lb3V0SGFuZGxlKTtcbiAgICAgICAgICAgIGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWxIYW5kbGUpO1xuICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgIH07XG59XG5cbi8vIFRoaXMgaXMgZm9yIGBhc2FwLmpzYCBvbmx5LlxuLy8gSXRzIG5hbWUgd2lsbCBiZSBwZXJpb2RpY2FsbHkgcmFuZG9taXplZCB0byBicmVhayBhbnkgY29kZSB0aGF0IGRlcGVuZHMgb25cbi8vIGl0cyBleGlzdGVuY2UuXG5yYXdBc2FwLm1ha2VSZXF1ZXN0Q2FsbEZyb21UaW1lciA9IG1ha2VSZXF1ZXN0Q2FsbEZyb21UaW1lcjtcblxuLy8gQVNBUCB3YXMgb3JpZ2luYWxseSBhIG5leHRUaWNrIHNoaW0gaW5jbHVkZWQgaW4gUS4gVGhpcyB3YXMgZmFjdG9yZWQgb3V0XG4vLyBpbnRvIHRoaXMgQVNBUCBwYWNrYWdlLiBJdCB3YXMgbGF0ZXIgYWRhcHRlZCB0byBSU1ZQIHdoaWNoIG1hZGUgZnVydGhlclxuLy8gYW1lbmRtZW50cy4gVGhlc2UgZGVjaXNpb25zLCBwYXJ0aWN1bGFybHkgdG8gbWFyZ2luYWxpemUgTWVzc2FnZUNoYW5uZWwgYW5kXG4vLyB0byBjYXB0dXJlIHRoZSBNdXRhdGlvbk9ic2VydmVyIGltcGxlbWVudGF0aW9uIGluIGEgY2xvc3VyZSwgd2VyZSBpbnRlZ3JhdGVkXG4vLyBiYWNrIGludG8gQVNBUCBwcm9wZXIuXG4vLyBodHRwczovL2dpdGh1Yi5jb20vdGlsZGVpby9yc3ZwLmpzL2Jsb2IvY2RkZjcyMzI1NDZhOWNmODU4NTI0Yjc1Y2RlNmY5ZWRmNzI2MjBhNy9saWIvcnN2cC9hc2FwLmpzXG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjb25zdGFudHMgPSByZXF1aXJlKCcuL3V0aWwvY29uc3RhbnRzJyksXG4gICAgTG9nZ2luZyAgID0gcmVxdWlyZSgnLi9taXhpbnMvbG9nZ2luZycpO1xuXG52YXIgRmF5ZSA9IHtcbiAgVkVSU0lPTjogICAgY29uc3RhbnRzLlZFUlNJT04sXG5cbiAgQ2xpZW50OiAgICAgcmVxdWlyZSgnLi9wcm90b2NvbC9jbGllbnQnKSxcbiAgU2NoZWR1bGVyOiAgcmVxdWlyZSgnLi9wcm90b2NvbC9zY2hlZHVsZXInKVxufTtcblxuTG9nZ2luZy53cmFwcGVyID0gRmF5ZTtcblxubW9kdWxlLmV4cG9ydHMgPSBGYXllO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgUHJvbWlzZSAgID0gcmVxdWlyZSgnLi4vdXRpbC9wcm9taXNlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICB0aGVuOiBmdW5jdGlvbihjYWxsYmFjaywgZXJyYmFjaykge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBpZiAoIXRoaXMuX3Byb21pc2UpXG4gICAgICB0aGlzLl9wcm9taXNlID0gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICAgIHNlbGYuX3Jlc29sdmUgPSByZXNvbHZlO1xuICAgICAgICBzZWxmLl9yZWplY3QgID0gcmVqZWN0O1xuICAgICAgfSk7XG5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMClcbiAgICAgIHJldHVybiB0aGlzLl9wcm9taXNlO1xuICAgIGVsc2VcbiAgICAgIHJldHVybiB0aGlzLl9wcm9taXNlLnRoZW4oY2FsbGJhY2ssIGVycmJhY2spO1xuICB9LFxuXG4gIGNhbGxiYWNrOiBmdW5jdGlvbihjYWxsYmFjaywgY29udGV4dCkge1xuICAgIHJldHVybiB0aGlzLnRoZW4oZnVuY3Rpb24odmFsdWUpIHsgY2FsbGJhY2suY2FsbChjb250ZXh0LCB2YWx1ZSkgfSk7XG4gIH0sXG5cbiAgZXJyYmFjazogZnVuY3Rpb24oY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICByZXR1cm4gdGhpcy50aGVuKG51bGwsIGZ1bmN0aW9uKHJlYXNvbikgeyBjYWxsYmFjay5jYWxsKGNvbnRleHQsIHJlYXNvbikgfSk7XG4gIH0sXG5cbiAgdGltZW91dDogZnVuY3Rpb24oc2Vjb25kcywgbWVzc2FnZSkge1xuICAgIHRoaXMudGhlbigpO1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLl90aW1lciA9IGdsb2JhbC5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgc2VsZi5fcmVqZWN0KG1lc3NhZ2UpO1xuICAgIH0sIHNlY29uZHMgKiAxMDAwKTtcbiAgfSxcblxuICBzZXREZWZlcnJlZFN0YXR1czogZnVuY3Rpb24oc3RhdHVzLCB2YWx1ZSkge1xuICAgIGlmICh0aGlzLl90aW1lcikgZ2xvYmFsLmNsZWFyVGltZW91dCh0aGlzLl90aW1lcik7XG5cbiAgICB0aGlzLnRoZW4oKTtcblxuICAgIGlmIChzdGF0dXMgPT09ICdzdWNjZWVkZWQnKVxuICAgICAgdGhpcy5fcmVzb2x2ZSh2YWx1ZSk7XG4gICAgZWxzZSBpZiAoc3RhdHVzID09PSAnZmFpbGVkJylcbiAgICAgIHRoaXMuX3JlamVjdCh2YWx1ZSk7XG4gICAgZWxzZVxuICAgICAgZGVsZXRlIHRoaXMuX3Byb21pc2U7XG4gIH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB0b0pTT04gPSByZXF1aXJlKCcuLi91dGlsL3RvX2pzb24nKTtcblxudmFyIExvZ2dpbmcgPSB7XG4gIExPR19MRVZFTFM6IHtcbiAgICBmYXRhbDogIDQsXG4gICAgZXJyb3I6ICAzLFxuICAgIHdhcm46ICAgMixcbiAgICBpbmZvOiAgIDEsXG4gICAgZGVidWc6ICAwXG4gIH0sXG5cbiAgd3JpdGVMb2c6IGZ1bmN0aW9uKG1lc3NhZ2VBcmdzLCBsZXZlbCkge1xuICAgIHZhciBsb2dnZXIgPSBMb2dnaW5nLmxvZ2dlciB8fCAoTG9nZ2luZy53cmFwcGVyIHx8IExvZ2dpbmcpLmxvZ2dlcjtcbiAgICBpZiAoIWxvZ2dlcikgcmV0dXJuO1xuXG4gICAgdmFyIGFyZ3MgICA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5hcHBseShtZXNzYWdlQXJncyksXG4gICAgICAgIGJhbm5lciA9ICdbRmF5ZScsXG4gICAgICAgIGtsYXNzICA9IHRoaXMuY2xhc3NOYW1lLFxuXG4gICAgICAgIG1lc3NhZ2UgPSBhcmdzLnNoaWZ0KCkucmVwbGFjZSgvXFw/L2csIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICByZXR1cm4gdG9KU09OKGFyZ3Muc2hpZnQoKSk7XG4gICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiAnW09iamVjdF0nO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICBpZiAoa2xhc3MpIGJhbm5lciArPSAnLicgKyBrbGFzcztcbiAgICBiYW5uZXIgKz0gJ10gJztcblxuICAgIGlmICh0eXBlb2YgbG9nZ2VyW2xldmVsXSA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIGxvZ2dlcltsZXZlbF0oYmFubmVyICsgbWVzc2FnZSk7XG4gICAgZWxzZSBpZiAodHlwZW9mIGxvZ2dlciA9PT0gJ2Z1bmN0aW9uJylcbiAgICAgIGxvZ2dlcihiYW5uZXIgKyBtZXNzYWdlKTtcbiAgfVxufTtcblxuZm9yICh2YXIga2V5IGluIExvZ2dpbmcuTE9HX0xFVkVMUylcbiAgKGZ1bmN0aW9uKGxldmVsKSB7XG4gICAgTG9nZ2luZ1tsZXZlbF0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMud3JpdGVMb2coYXJndW1lbnRzLCBsZXZlbCk7XG4gICAgfTtcbiAgfSkoa2V5KTtcblxubW9kdWxlLmV4cG9ydHMgPSBMb2dnaW5nO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmQnKSxcbiAgICBFdmVudEVtaXR0ZXIgPSByZXF1aXJlKCcuLi91dGlsL2V2ZW50X2VtaXR0ZXInKTtcblxudmFyIFB1Ymxpc2hlciA9IHtcbiAgY291bnRMaXN0ZW5lcnM6IGZ1bmN0aW9uKGV2ZW50VHlwZSkge1xuICAgIHJldHVybiB0aGlzLmxpc3RlbmVycyhldmVudFR5cGUpLmxlbmd0aDtcbiAgfSxcblxuICBiaW5kOiBmdW5jdGlvbihldmVudFR5cGUsIGxpc3RlbmVyLCBjb250ZXh0KSB7XG4gICAgdmFyIHNsaWNlICAgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UsXG4gICAgICAgIGhhbmRsZXIgPSBmdW5jdGlvbigpIHsgbGlzdGVuZXIuYXBwbHkoY29udGV4dCwgc2xpY2UuY2FsbChhcmd1bWVudHMpKSB9O1xuXG4gICAgdGhpcy5fbGlzdGVuZXJzID0gdGhpcy5fbGlzdGVuZXJzIHx8IFtdO1xuICAgIHRoaXMuX2xpc3RlbmVycy5wdXNoKFtldmVudFR5cGUsIGxpc3RlbmVyLCBjb250ZXh0LCBoYW5kbGVyXSk7XG4gICAgcmV0dXJuIHRoaXMub24oZXZlbnRUeXBlLCBoYW5kbGVyKTtcbiAgfSxcblxuICB1bmJpbmQ6IGZ1bmN0aW9uKGV2ZW50VHlwZSwgbGlzdGVuZXIsIGNvbnRleHQpIHtcbiAgICB0aGlzLl9saXN0ZW5lcnMgPSB0aGlzLl9saXN0ZW5lcnMgfHwgW107XG4gICAgdmFyIG4gPSB0aGlzLl9saXN0ZW5lcnMubGVuZ3RoLCB0dXBsZTtcblxuICAgIHdoaWxlIChuLS0pIHtcbiAgICAgIHR1cGxlID0gdGhpcy5fbGlzdGVuZXJzW25dO1xuICAgICAgaWYgKHR1cGxlWzBdICE9PSBldmVudFR5cGUpIGNvbnRpbnVlO1xuICAgICAgaWYgKGxpc3RlbmVyICYmICh0dXBsZVsxXSAhPT0gbGlzdGVuZXIgfHwgdHVwbGVbMl0gIT09IGNvbnRleHQpKSBjb250aW51ZTtcbiAgICAgIHRoaXMuX2xpc3RlbmVycy5zcGxpY2UobiwgMSk7XG4gICAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKGV2ZW50VHlwZSwgdHVwbGVbM10pO1xuICAgIH1cbiAgfVxufTtcblxuZXh0ZW5kKFB1Ymxpc2hlciwgRXZlbnRFbWl0dGVyLnByb3RvdHlwZSk7XG5QdWJsaXNoZXIudHJpZ2dlciA9IFB1Ymxpc2hlci5lbWl0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFB1Ymxpc2hlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGFkZFRpbWVvdXQ6IGZ1bmN0aW9uKG5hbWUsIGRlbGF5LCBjYWxsYmFjaywgY29udGV4dCkge1xuICAgIHRoaXMuX3RpbWVvdXRzID0gdGhpcy5fdGltZW91dHMgfHwge307XG4gICAgaWYgKHRoaXMuX3RpbWVvdXRzLmhhc093blByb3BlcnR5KG5hbWUpKSByZXR1cm47XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuX3RpbWVvdXRzW25hbWVdID0gZ2xvYmFsLnNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBkZWxldGUgc2VsZi5fdGltZW91dHNbbmFtZV07XG4gICAgICBjYWxsYmFjay5jYWxsKGNvbnRleHQpO1xuICAgIH0sIDEwMDAgKiBkZWxheSk7XG4gIH0sXG5cbiAgcmVtb3ZlVGltZW91dDogZnVuY3Rpb24obmFtZSkge1xuICAgIHRoaXMuX3RpbWVvdXRzID0gdGhpcy5fdGltZW91dHMgfHwge307XG4gICAgdmFyIHRpbWVvdXQgPSB0aGlzLl90aW1lb3V0c1tuYW1lXTtcbiAgICBpZiAoIXRpbWVvdXQpIHJldHVybjtcbiAgICBnbG9iYWwuY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgIGRlbGV0ZSB0aGlzLl90aW1lb3V0c1tuYW1lXTtcbiAgfSxcblxuICByZW1vdmVBbGxUaW1lb3V0czogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5fdGltZW91dHMgPSB0aGlzLl90aW1lb3V0cyB8fCB7fTtcbiAgICBmb3IgKHZhciBuYW1lIGluIHRoaXMuX3RpbWVvdXRzKSB0aGlzLnJlbW92ZVRpbWVvdXQobmFtZSk7XG4gIH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBDbGFzcyAgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgZXh0ZW5kICAgID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmQnKSxcbiAgICBQdWJsaXNoZXIgPSByZXF1aXJlKCcuLi9taXhpbnMvcHVibGlzaGVyJyksXG4gICAgR3JhbW1hciAgID0gcmVxdWlyZSgnLi9ncmFtbWFyJyk7XG5cbnZhciBDaGFubmVsID0gQ2xhc3Moe1xuICBpbml0aWFsaXplOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdGhpcy5pZCA9IHRoaXMubmFtZSA9IG5hbWU7XG4gIH0sXG5cbiAgcHVzaDogZnVuY3Rpb24obWVzc2FnZSkge1xuICAgIHRoaXMudHJpZ2dlcignbWVzc2FnZScsIG1lc3NhZ2UpO1xuICB9LFxuXG4gIGlzVW51c2VkOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gdGhpcy5jb3VudExpc3RlbmVycygnbWVzc2FnZScpID09PSAwO1xuICB9XG59KTtcblxuZXh0ZW5kKENoYW5uZWwucHJvdG90eXBlLCBQdWJsaXNoZXIpO1xuXG5leHRlbmQoQ2hhbm5lbCwge1xuICBIQU5EU0hBS0U6ICAgICcvbWV0YS9oYW5kc2hha2UnLFxuICBDT05ORUNUOiAgICAgICcvbWV0YS9jb25uZWN0JyxcbiAgU1VCU0NSSUJFOiAgICAnL21ldGEvc3Vic2NyaWJlJyxcbiAgVU5TVUJTQ1JJQkU6ICAnL21ldGEvdW5zdWJzY3JpYmUnLFxuICBESVNDT05ORUNUOiAgICcvbWV0YS9kaXNjb25uZWN0JyxcblxuICBNRVRBOiAgICAgICAgICdtZXRhJyxcbiAgU0VSVklDRTogICAgICAnc2VydmljZScsXG5cbiAgZXhwYW5kOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIHNlZ21lbnRzID0gdGhpcy5wYXJzZShuYW1lKSxcbiAgICAgICAgY2hhbm5lbHMgPSBbJy8qKicsIG5hbWVdO1xuXG4gICAgdmFyIGNvcHkgPSBzZWdtZW50cy5zbGljZSgpO1xuICAgIGNvcHlbY29weS5sZW5ndGggLSAxXSA9ICcqJztcbiAgICBjaGFubmVscy5wdXNoKHRoaXMudW5wYXJzZShjb3B5KSk7XG5cbiAgICBmb3IgKHZhciBpID0gMSwgbiA9IHNlZ21lbnRzLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgY29weSA9IHNlZ21lbnRzLnNsaWNlKDAsIGkpO1xuICAgICAgY29weS5wdXNoKCcqKicpO1xuICAgICAgY2hhbm5lbHMucHVzaCh0aGlzLnVucGFyc2UoY29weSkpO1xuICAgIH1cblxuICAgIHJldHVybiBjaGFubmVscztcbiAgfSxcblxuICBpc1ZhbGlkOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIEdyYW1tYXIuQ0hBTk5FTF9OQU1FLnRlc3QobmFtZSkgfHxcbiAgICAgICAgICAgR3JhbW1hci5DSEFOTkVMX1BBVFRFUk4udGVzdChuYW1lKTtcbiAgfSxcblxuICBwYXJzZTogZnVuY3Rpb24obmFtZSkge1xuICAgIGlmICghdGhpcy5pc1ZhbGlkKG5hbWUpKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gbmFtZS5zcGxpdCgnLycpLnNsaWNlKDEpO1xuICB9LFxuXG4gIHVucGFyc2U6IGZ1bmN0aW9uKHNlZ21lbnRzKSB7XG4gICAgcmV0dXJuICcvJyArIHNlZ21lbnRzLmpvaW4oJy8nKTtcbiAgfSxcblxuICBpc01ldGE6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgc2VnbWVudHMgPSB0aGlzLnBhcnNlKG5hbWUpO1xuICAgIHJldHVybiBzZWdtZW50cyA/IChzZWdtZW50c1swXSA9PT0gdGhpcy5NRVRBKSA6IG51bGw7XG4gIH0sXG5cbiAgaXNTZXJ2aWNlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIHNlZ21lbnRzID0gdGhpcy5wYXJzZShuYW1lKTtcbiAgICByZXR1cm4gc2VnbWVudHMgPyAoc2VnbWVudHNbMF0gPT09IHRoaXMuU0VSVklDRSkgOiBudWxsO1xuICB9LFxuXG4gIGlzU3Vic2NyaWJhYmxlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgaWYgKCF0aGlzLmlzVmFsaWQobmFtZSkpIHJldHVybiBudWxsO1xuICAgIHJldHVybiAhdGhpcy5pc01ldGEobmFtZSkgJiYgIXRoaXMuaXNTZXJ2aWNlKG5hbWUpO1xuICB9LFxuXG4gIFNldDogQ2xhc3Moe1xuICAgIGluaXRpYWxpemU6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5fY2hhbm5lbHMgPSB7fTtcbiAgICB9LFxuXG4gICAgZ2V0S2V5czogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIga2V5cyA9IFtdO1xuICAgICAgZm9yICh2YXIga2V5IGluIHRoaXMuX2NoYW5uZWxzKSBrZXlzLnB1c2goa2V5KTtcbiAgICAgIHJldHVybiBrZXlzO1xuICAgIH0sXG5cbiAgICByZW1vdmU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIGRlbGV0ZSB0aGlzLl9jaGFubmVsc1tuYW1lXTtcbiAgICB9LFxuXG4gICAgaGFzU3Vic2NyaXB0aW9uOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgICByZXR1cm4gdGhpcy5fY2hhbm5lbHMuaGFzT3duUHJvcGVydHkobmFtZSk7XG4gICAgfSxcblxuICAgIHN1YnNjcmliZTogZnVuY3Rpb24obmFtZXMsIHN1YnNjcmlwdGlvbikge1xuICAgICAgdmFyIG5hbWU7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbiA9IG5hbWVzLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgICBuYW1lID0gbmFtZXNbaV07XG4gICAgICAgIHZhciBjaGFubmVsID0gdGhpcy5fY2hhbm5lbHNbbmFtZV0gPSB0aGlzLl9jaGFubmVsc1tuYW1lXSB8fCBuZXcgQ2hhbm5lbChuYW1lKTtcbiAgICAgICAgY2hhbm5lbC5iaW5kKCdtZXNzYWdlJywgc3Vic2NyaXB0aW9uKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdW5zdWJzY3JpYmU6IGZ1bmN0aW9uKG5hbWUsIHN1YnNjcmlwdGlvbikge1xuICAgICAgdmFyIGNoYW5uZWwgPSB0aGlzLl9jaGFubmVsc1tuYW1lXTtcbiAgICAgIGlmICghY2hhbm5lbCkgcmV0dXJuIGZhbHNlO1xuICAgICAgY2hhbm5lbC51bmJpbmQoJ21lc3NhZ2UnLCBzdWJzY3JpcHRpb24pO1xuXG4gICAgICBpZiAoY2hhbm5lbC5pc1VudXNlZCgpKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlKG5hbWUpO1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgZGlzdHJpYnV0ZU1lc3NhZ2U6IGZ1bmN0aW9uKG1lc3NhZ2UpIHtcbiAgICAgIHZhciBjaGFubmVscyA9IENoYW5uZWwuZXhwYW5kKG1lc3NhZ2UuY2hhbm5lbCk7XG5cbiAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gY2hhbm5lbHMubGVuZ3RoOyBpIDwgbjsgaSsrKSB7XG4gICAgICAgIHZhciBjaGFubmVsID0gdGhpcy5fY2hhbm5lbHNbY2hhbm5lbHNbaV1dO1xuICAgICAgICBpZiAoY2hhbm5lbCkgY2hhbm5lbC50cmlnZ2VyKCdtZXNzYWdlJywgbWVzc2FnZSk7XG4gICAgICB9XG4gICAgfVxuICB9KVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hhbm5lbDtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGFzYXAgICAgICAgICAgICA9IHJlcXVpcmUoJ2FzYXAnKSxcbiAgICBDbGFzcyAgICAgICAgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgUHJvbWlzZSAgICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9wcm9taXNlJyksXG4gICAgVVJJICAgICAgICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC91cmknKSxcbiAgICBhcnJheSAgICAgICAgICAgPSByZXF1aXJlKCcuLi91dGlsL2FycmF5JyksXG4gICAgYnJvd3NlciAgICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9icm93c2VyJyksXG4gICAgY29uc3RhbnRzICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9jb25zdGFudHMnKSxcbiAgICBleHRlbmQgICAgICAgICAgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZCcpLFxuICAgIHZhbGlkYXRlT3B0aW9ucyA9IHJlcXVpcmUoJy4uL3V0aWwvdmFsaWRhdGVfb3B0aW9ucycpLFxuICAgIERlZmVycmFibGUgICAgICA9IHJlcXVpcmUoJy4uL21peGlucy9kZWZlcnJhYmxlJyksXG4gICAgTG9nZ2luZyAgICAgICAgID0gcmVxdWlyZSgnLi4vbWl4aW5zL2xvZ2dpbmcnKSxcbiAgICBQdWJsaXNoZXIgICAgICAgPSByZXF1aXJlKCcuLi9taXhpbnMvcHVibGlzaGVyJyksXG4gICAgQ2hhbm5lbCAgICAgICAgID0gcmVxdWlyZSgnLi9jaGFubmVsJyksXG4gICAgRGlzcGF0Y2hlciAgICAgID0gcmVxdWlyZSgnLi9kaXNwYXRjaGVyJyksXG4gICAgRXJyb3IgICAgICAgICAgID0gcmVxdWlyZSgnLi9lcnJvcicpLFxuICAgIEV4dGVuc2libGUgICAgICA9IHJlcXVpcmUoJy4vZXh0ZW5zaWJsZScpLFxuICAgIFB1YmxpY2F0aW9uICAgICA9IHJlcXVpcmUoJy4vcHVibGljYXRpb24nKSxcbiAgICBTdWJzY3JpcHRpb24gICAgPSByZXF1aXJlKCcuL3N1YnNjcmlwdGlvbicpO1xuXG52YXIgQ2xpZW50ID0gQ2xhc3MoeyBjbGFzc05hbWU6ICdDbGllbnQnLFxuICBVTkNPTk5FQ1RFRDogICAgICAgIDEsXG4gIENPTk5FQ1RJTkc6ICAgICAgICAgMixcbiAgQ09OTkVDVEVEOiAgICAgICAgICAzLFxuICBESVNDT05ORUNURUQ6ICAgICAgIDQsXG5cbiAgSEFORFNIQUtFOiAgICAgICAgICAnaGFuZHNoYWtlJyxcbiAgUkVUUlk6ICAgICAgICAgICAgICAncmV0cnknLFxuICBOT05FOiAgICAgICAgICAgICAgICdub25lJyxcblxuICBDT05ORUNUSU9OX1RJTUVPVVQ6IDYwLFxuXG4gIERFRkFVTFRfRU5EUE9JTlQ6ICAgJy9iYXlldXgnLFxuICBJTlRFUlZBTDogICAgICAgICAgIDAsXG5cbiAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oZW5kcG9pbnQsIG9wdGlvbnMpIHtcbiAgICB0aGlzLmluZm8oJ05ldyBjbGllbnQgY3JlYXRlZCBmb3IgPycsIGVuZHBvaW50KTtcbiAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgIHZhbGlkYXRlT3B0aW9ucyhvcHRpb25zLCBbJ2ludGVydmFsJywgJ3RpbWVvdXQnLCAnZW5kcG9pbnRzJywgJ3Byb3h5JywgJ3JldHJ5JywgJ3NjaGVkdWxlcicsICd3ZWJzb2NrZXRFeHRlbnNpb25zJywgJ3RscycsICdjYSddKTtcblxuICAgIHRoaXMuX2NoYW5uZWxzICAgPSBuZXcgQ2hhbm5lbC5TZXQoKTtcbiAgICB0aGlzLl9kaXNwYXRjaGVyID0gRGlzcGF0Y2hlci5jcmVhdGUodGhpcywgZW5kcG9pbnQgfHwgdGhpcy5ERUZBVUxUX0VORFBPSU5ULCBvcHRpb25zKTtcblxuICAgIHRoaXMuX21lc3NhZ2VJZCA9IDA7XG4gICAgdGhpcy5fc3RhdGUgICAgID0gdGhpcy5VTkNPTk5FQ1RFRDtcblxuICAgIHRoaXMuX3Jlc3BvbnNlQ2FsbGJhY2tzID0ge307XG5cbiAgICB0aGlzLl9hZHZpY2UgPSB7XG4gICAgICByZWNvbm5lY3Q6IHRoaXMuUkVUUlksXG4gICAgICBpbnRlcnZhbDogIDEwMDAgKiAob3B0aW9ucy5pbnRlcnZhbCB8fCB0aGlzLklOVEVSVkFMKSxcbiAgICAgIHRpbWVvdXQ6ICAgMTAwMCAqIChvcHRpb25zLnRpbWVvdXQgIHx8IHRoaXMuQ09OTkVDVElPTl9USU1FT1VUKVxuICAgIH07XG4gICAgdGhpcy5fZGlzcGF0Y2hlci50aW1lb3V0ID0gdGhpcy5fYWR2aWNlLnRpbWVvdXQgLyAxMDAwO1xuXG4gICAgdGhpcy5fZGlzcGF0Y2hlci5iaW5kKCdtZXNzYWdlJywgdGhpcy5fcmVjZWl2ZU1lc3NhZ2UsIHRoaXMpO1xuXG4gICAgaWYgKGJyb3dzZXIuRXZlbnQgJiYgZ2xvYmFsLm9uYmVmb3JldW5sb2FkICE9PSB1bmRlZmluZWQpXG4gICAgICBicm93c2VyLkV2ZW50Lm9uKGdsb2JhbCwgJ2JlZm9yZXVubG9hZCcsIGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoYXJyYXkuaW5kZXhPZih0aGlzLl9kaXNwYXRjaGVyLl9kaXNhYmxlZCwgJ2F1dG9kaXNjb25uZWN0JykgPCAwKVxuICAgICAgICAgIHRoaXMuZGlzY29ubmVjdCgpO1xuICAgICAgfSwgdGhpcyk7XG4gIH0sXG5cbiAgYWRkV2Vic29ja2V0RXh0ZW5zaW9uOiBmdW5jdGlvbihleHRlbnNpb24pIHtcbiAgICByZXR1cm4gdGhpcy5fZGlzcGF0Y2hlci5hZGRXZWJzb2NrZXRFeHRlbnNpb24oZXh0ZW5zaW9uKTtcbiAgfSxcblxuICBkaXNhYmxlOiBmdW5jdGlvbihmZWF0dXJlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Rpc3BhdGNoZXIuZGlzYWJsZShmZWF0dXJlKTtcbiAgfSxcblxuICBzZXRIZWFkZXI6IGZ1bmN0aW9uKG5hbWUsIHZhbHVlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2Rpc3BhdGNoZXIuc2V0SGVhZGVyKG5hbWUsIHZhbHVlKTtcbiAgfSxcblxuICAvLyBSZXF1ZXN0XG4gIC8vIE1VU1QgaW5jbHVkZTogICogY2hhbm5lbFxuICAvLyAgICAgICAgICAgICAgICAqIHZlcnNpb25cbiAgLy8gICAgICAgICAgICAgICAgKiBzdXBwb3J0ZWRDb25uZWN0aW9uVHlwZXNcbiAgLy8gTUFZIGluY2x1ZGU6ICAgKiBtaW5pbXVtVmVyc2lvblxuICAvLyAgICAgICAgICAgICAgICAqIGV4dFxuICAvLyAgICAgICAgICAgICAgICAqIGlkXG4gIC8vXG4gIC8vIFN1Y2Nlc3MgUmVzcG9uc2UgICAgICAgICAgICAgICAgICAgICAgICAgICAgIEZhaWxlZCBSZXNwb25zZVxuICAvLyBNVVNUIGluY2x1ZGU6ICAqIGNoYW5uZWwgICAgICAgICAgICAgICAgICAgICBNVVNUIGluY2x1ZGU6ICAqIGNoYW5uZWxcbiAgLy8gICAgICAgICAgICAgICAgKiB2ZXJzaW9uICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBzdWNjZXNzZnVsXG4gIC8vICAgICAgICAgICAgICAgICogc3VwcG9ydGVkQ29ubmVjdGlvblR5cGVzICAgICAgICAgICAgICAgICAgICogZXJyb3JcbiAgLy8gICAgICAgICAgICAgICAgKiBjbGllbnRJZCAgICAgICAgICAgICAgICAgICAgTUFZIGluY2x1ZGU6ICAgKiBzdXBwb3J0ZWRDb25uZWN0aW9uVHlwZXNcbiAgLy8gICAgICAgICAgICAgICAgKiBzdWNjZXNzZnVsICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBhZHZpY2VcbiAgLy8gTUFZIGluY2x1ZGU6ICAgKiBtaW5pbXVtVmVyc2lvbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiB2ZXJzaW9uXG4gIC8vICAgICAgICAgICAgICAgICogYWR2aWNlICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogbWluaW11bVZlcnNpb25cbiAgLy8gICAgICAgICAgICAgICAgKiBleHQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBleHRcbiAgLy8gICAgICAgICAgICAgICAgKiBpZCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBpZFxuICAvLyAgICAgICAgICAgICAgICAqIGF1dGhTdWNjZXNzZnVsXG4gIGhhbmRzaGFrZTogZnVuY3Rpb24oY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5fYWR2aWNlLnJlY29ubmVjdCA9PT0gdGhpcy5OT05FKSByZXR1cm47XG4gICAgaWYgKHRoaXMuX3N0YXRlICE9PSB0aGlzLlVOQ09OTkVDVEVEKSByZXR1cm47XG5cbiAgICB0aGlzLl9zdGF0ZSA9IHRoaXMuQ09OTkVDVElORztcbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB0aGlzLmluZm8oJ0luaXRpYXRpbmcgaGFuZHNoYWtlIHdpdGggPycsIFVSSS5zdHJpbmdpZnkodGhpcy5fZGlzcGF0Y2hlci5lbmRwb2ludCkpO1xuICAgIHRoaXMuX2Rpc3BhdGNoZXIuc2VsZWN0VHJhbnNwb3J0KGNvbnN0YW50cy5NQU5EQVRPUllfQ09OTkVDVElPTl9UWVBFUyk7XG5cbiAgICB0aGlzLl9zZW5kTWVzc2FnZSh7XG4gICAgICBjaGFubmVsOiAgICAgICAgICAgICAgICAgIENoYW5uZWwuSEFORFNIQUtFLFxuICAgICAgdmVyc2lvbjogICAgICAgICAgICAgICAgICBjb25zdGFudHMuQkFZRVVYX1ZFUlNJT04sXG4gICAgICBzdXBwb3J0ZWRDb25uZWN0aW9uVHlwZXM6IHRoaXMuX2Rpc3BhdGNoZXIuZ2V0Q29ubmVjdGlvblR5cGVzKClcblxuICAgIH0sIHt9LCBmdW5jdGlvbihyZXNwb25zZSkge1xuXG4gICAgICBpZiAocmVzcG9uc2Uuc3VjY2Vzc2Z1bCkge1xuICAgICAgICB0aGlzLl9zdGF0ZSA9IHRoaXMuQ09OTkVDVEVEO1xuICAgICAgICB0aGlzLl9kaXNwYXRjaGVyLmNsaWVudElkICA9IHJlc3BvbnNlLmNsaWVudElkO1xuXG4gICAgICAgIHRoaXMuX2Rpc3BhdGNoZXIuc2VsZWN0VHJhbnNwb3J0KHJlc3BvbnNlLnN1cHBvcnRlZENvbm5lY3Rpb25UeXBlcyk7XG5cbiAgICAgICAgdGhpcy5pbmZvKCdIYW5kc2hha2Ugc3VjY2Vzc2Z1bDogPycsIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQpO1xuXG4gICAgICAgIHRoaXMuc3Vic2NyaWJlKHRoaXMuX2NoYW5uZWxzLmdldEtleXMoKSwgdHJ1ZSk7XG4gICAgICAgIGlmIChjYWxsYmFjaykgYXNhcChmdW5jdGlvbigpIHsgY2FsbGJhY2suY2FsbChjb250ZXh0KSB9KTtcblxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5pbmZvKCdIYW5kc2hha2UgdW5zdWNjZXNzZnVsJyk7XG4gICAgICAgIGdsb2JhbC5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkgeyBzZWxmLmhhbmRzaGFrZShjYWxsYmFjaywgY29udGV4dCkgfSwgdGhpcy5fZGlzcGF0Y2hlci5yZXRyeSAqIDEwMDApO1xuICAgICAgICB0aGlzLl9zdGF0ZSA9IHRoaXMuVU5DT05ORUNURUQ7XG4gICAgICB9XG4gICAgfSwgdGhpcyk7XG4gIH0sXG5cbiAgLy8gUmVxdWVzdCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlc3BvbnNlXG4gIC8vIE1VU1QgaW5jbHVkZTogICogY2hhbm5lbCAgICAgICAgICAgICBNVVNUIGluY2x1ZGU6ICAqIGNoYW5uZWxcbiAgLy8gICAgICAgICAgICAgICAgKiBjbGllbnRJZCAgICAgICAgICAgICAgICAgICAgICAgICAgICogc3VjY2Vzc2Z1bFxuICAvLyAgICAgICAgICAgICAgICAqIGNvbm5lY3Rpb25UeXBlICAgICAgICAgICAgICAgICAgICAgKiBjbGllbnRJZFxuICAvLyBNQVkgaW5jbHVkZTogICAqIGV4dCAgICAgICAgICAgICAgICAgTUFZIGluY2x1ZGU6ICAgKiBlcnJvclxuICAvLyAgICAgICAgICAgICAgICAqIGlkICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBhZHZpY2VcbiAgLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogZXh0XG4gIC8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIGlkXG4gIC8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIHRpbWVzdGFtcFxuICBjb25uZWN0OiBmdW5jdGlvbihjYWxsYmFjaywgY29udGV4dCkge1xuICAgIGlmICh0aGlzLl9hZHZpY2UucmVjb25uZWN0ID09PSB0aGlzLk5PTkUpIHJldHVybjtcbiAgICBpZiAodGhpcy5fc3RhdGUgPT09IHRoaXMuRElTQ09OTkVDVEVEKSByZXR1cm47XG5cbiAgICBpZiAodGhpcy5fc3RhdGUgPT09IHRoaXMuVU5DT05ORUNURUQpXG4gICAgICByZXR1cm4gdGhpcy5oYW5kc2hha2UoZnVuY3Rpb24oKSB7IHRoaXMuY29ubmVjdChjYWxsYmFjaywgY29udGV4dCkgfSwgdGhpcyk7XG5cbiAgICB0aGlzLmNhbGxiYWNrKGNhbGxiYWNrLCBjb250ZXh0KTtcbiAgICBpZiAodGhpcy5fc3RhdGUgIT09IHRoaXMuQ09OTkVDVEVEKSByZXR1cm47XG5cbiAgICB0aGlzLmluZm8oJ0NhbGxpbmcgZGVmZXJyZWQgYWN0aW9ucyBmb3IgPycsIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQpO1xuICAgIHRoaXMuc2V0RGVmZXJyZWRTdGF0dXMoJ3N1Y2NlZWRlZCcpO1xuICAgIHRoaXMuc2V0RGVmZXJyZWRTdGF0dXMoJ3Vua25vd24nKTtcblxuICAgIGlmICh0aGlzLl9jb25uZWN0UmVxdWVzdCkgcmV0dXJuO1xuICAgIHRoaXMuX2Nvbm5lY3RSZXF1ZXN0ID0gdHJ1ZTtcblxuICAgIHRoaXMuaW5mbygnSW5pdGlhdGluZyBjb25uZWN0aW9uIGZvciA/JywgdGhpcy5fZGlzcGF0Y2hlci5jbGllbnRJZCk7XG5cbiAgICB0aGlzLl9zZW5kTWVzc2FnZSh7XG4gICAgICBjaGFubmVsOiAgICAgICAgQ2hhbm5lbC5DT05ORUNULFxuICAgICAgY2xpZW50SWQ6ICAgICAgIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQsXG4gICAgICBjb25uZWN0aW9uVHlwZTogdGhpcy5fZGlzcGF0Y2hlci5jb25uZWN0aW9uVHlwZVxuXG4gICAgfSwge30sIHRoaXMuX2N5Y2xlQ29ubmVjdGlvbiwgdGhpcyk7XG4gIH0sXG5cbiAgLy8gUmVxdWVzdCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIFJlc3BvbnNlXG4gIC8vIE1VU1QgaW5jbHVkZTogICogY2hhbm5lbCAgICAgICAgICAgICBNVVNUIGluY2x1ZGU6ICAqIGNoYW5uZWxcbiAgLy8gICAgICAgICAgICAgICAgKiBjbGllbnRJZCAgICAgICAgICAgICAgICAgICAgICAgICAgICogc3VjY2Vzc2Z1bFxuICAvLyBNQVkgaW5jbHVkZTogICAqIGV4dCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBjbGllbnRJZFxuICAvLyAgICAgICAgICAgICAgICAqIGlkICAgICAgICAgICAgICAgICAgTUFZIGluY2x1ZGU6ICAgKiBlcnJvclxuICAvLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBleHRcbiAgLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogaWRcbiAgZGlzY29ubmVjdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX3N0YXRlICE9PSB0aGlzLkNPTk5FQ1RFRCkgcmV0dXJuO1xuICAgIHRoaXMuX3N0YXRlID0gdGhpcy5ESVNDT05ORUNURUQ7XG5cbiAgICB0aGlzLmluZm8oJ0Rpc2Nvbm5lY3RpbmcgPycsIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQpO1xuICAgIHZhciBwcm9taXNlID0gbmV3IFB1YmxpY2F0aW9uKCk7XG5cbiAgICB0aGlzLl9zZW5kTWVzc2FnZSh7XG4gICAgICBjaGFubmVsOiAgQ2hhbm5lbC5ESVNDT05ORUNULFxuICAgICAgY2xpZW50SWQ6IHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWRcblxuICAgIH0sIHt9LCBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgaWYgKHJlc3BvbnNlLnN1Y2Nlc3NmdWwpIHtcbiAgICAgICAgdGhpcy5fZGlzcGF0Y2hlci5jbG9zZSgpO1xuICAgICAgICBwcm9taXNlLnNldERlZmVycmVkU3RhdHVzKCdzdWNjZWVkZWQnKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHByb21pc2Uuc2V0RGVmZXJyZWRTdGF0dXMoJ2ZhaWxlZCcsIEVycm9yLnBhcnNlKHJlc3BvbnNlLmVycm9yKSk7XG4gICAgICB9XG4gICAgfSwgdGhpcyk7XG5cbiAgICB0aGlzLmluZm8oJ0NsZWFyaW5nIGNoYW5uZWwgbGlzdGVuZXJzIGZvciA/JywgdGhpcy5fZGlzcGF0Y2hlci5jbGllbnRJZCk7XG4gICAgdGhpcy5fY2hhbm5lbHMgPSBuZXcgQ2hhbm5lbC5TZXQoKTtcblxuICAgIHJldHVybiBwcm9taXNlO1xuICB9LFxuXG4gIC8vIFJlcXVlc3QgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBSZXNwb25zZVxuICAvLyBNVVNUIGluY2x1ZGU6ICAqIGNoYW5uZWwgICAgICAgICAgICAgTVVTVCBpbmNsdWRlOiAgKiBjaGFubmVsXG4gIC8vICAgICAgICAgICAgICAgICogY2xpZW50SWQgICAgICAgICAgICAgICAgICAgICAgICAgICAqIHN1Y2Nlc3NmdWxcbiAgLy8gICAgICAgICAgICAgICAgKiBzdWJzY3JpcHRpb24gICAgICAgICAgICAgICAgICAgICAgICogY2xpZW50SWRcbiAgLy8gTUFZIGluY2x1ZGU6ICAgKiBleHQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogc3Vic2NyaXB0aW9uXG4gIC8vICAgICAgICAgICAgICAgICogaWQgICAgICAgICAgICAgICAgICBNQVkgaW5jbHVkZTogICAqIGVycm9yXG4gIC8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIGFkdmljZVxuICAvLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBleHRcbiAgLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogaWRcbiAgLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogdGltZXN0YW1wXG4gIHN1YnNjcmliZTogZnVuY3Rpb24oY2hhbm5lbCwgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICBpZiAoY2hhbm5lbCBpbnN0YW5jZW9mIEFycmF5KVxuICAgICAgcmV0dXJuIGFycmF5Lm1hcChjaGFubmVsLCBmdW5jdGlvbihjKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN1YnNjcmliZShjLCBjYWxsYmFjaywgY29udGV4dCk7XG4gICAgICB9LCB0aGlzKTtcblxuICAgIHZhciBzdWJzY3JpcHRpb24gPSBuZXcgU3Vic2NyaXB0aW9uKHRoaXMsIGNoYW5uZWwsIGNhbGxiYWNrLCBjb250ZXh0KSxcbiAgICAgICAgZm9yY2UgICAgICAgID0gKGNhbGxiYWNrID09PSB0cnVlKSxcbiAgICAgICAgaGFzU3Vic2NyaWJlID0gdGhpcy5fY2hhbm5lbHMuaGFzU3Vic2NyaXB0aW9uKGNoYW5uZWwpO1xuXG4gICAgaWYgKGhhc1N1YnNjcmliZSAmJiAhZm9yY2UpIHtcbiAgICAgIHRoaXMuX2NoYW5uZWxzLnN1YnNjcmliZShbY2hhbm5lbF0sIHN1YnNjcmlwdGlvbik7XG4gICAgICBzdWJzY3JpcHRpb24uc2V0RGVmZXJyZWRTdGF0dXMoJ3N1Y2NlZWRlZCcpO1xuICAgICAgcmV0dXJuIHN1YnNjcmlwdGlvbjtcbiAgICB9XG5cbiAgICB0aGlzLmNvbm5lY3QoZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmluZm8oJ0NsaWVudCA/IGF0dGVtcHRpbmcgdG8gc3Vic2NyaWJlIHRvID8nLCB0aGlzLl9kaXNwYXRjaGVyLmNsaWVudElkLCBjaGFubmVsKTtcbiAgICAgIGlmICghZm9yY2UpIHRoaXMuX2NoYW5uZWxzLnN1YnNjcmliZShbY2hhbm5lbF0sIHN1YnNjcmlwdGlvbik7XG5cbiAgICAgIHRoaXMuX3NlbmRNZXNzYWdlKHtcbiAgICAgICAgY2hhbm5lbDogICAgICBDaGFubmVsLlNVQlNDUklCRSxcbiAgICAgICAgY2xpZW50SWQ6ICAgICB0aGlzLl9kaXNwYXRjaGVyLmNsaWVudElkLFxuICAgICAgICBzdWJzY3JpcHRpb246IGNoYW5uZWxcblxuICAgICAgfSwge30sIGZ1bmN0aW9uKHJlc3BvbnNlKSB7XG4gICAgICAgIGlmICghcmVzcG9uc2Uuc3VjY2Vzc2Z1bCkge1xuICAgICAgICAgIHN1YnNjcmlwdGlvbi5zZXREZWZlcnJlZFN0YXR1cygnZmFpbGVkJywgRXJyb3IucGFyc2UocmVzcG9uc2UuZXJyb3IpKTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fY2hhbm5lbHMudW5zdWJzY3JpYmUoY2hhbm5lbCwgc3Vic2NyaXB0aW9uKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBjaGFubmVscyA9IFtdLmNvbmNhdChyZXNwb25zZS5zdWJzY3JpcHRpb24pO1xuICAgICAgICB0aGlzLmluZm8oJ1N1YnNjcmlwdGlvbiBhY2tub3dsZWRnZWQgZm9yID8gdG8gPycsIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQsIGNoYW5uZWxzKTtcbiAgICAgICAgc3Vic2NyaXB0aW9uLnNldERlZmVycmVkU3RhdHVzKCdzdWNjZWVkZWQnKTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH0sIHRoaXMpO1xuXG4gICAgcmV0dXJuIHN1YnNjcmlwdGlvbjtcbiAgfSxcblxuICAvLyBSZXF1ZXN0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgUmVzcG9uc2VcbiAgLy8gTVVTVCBpbmNsdWRlOiAgKiBjaGFubmVsICAgICAgICAgICAgIE1VU1QgaW5jbHVkZTogICogY2hhbm5lbFxuICAvLyAgICAgICAgICAgICAgICAqIGNsaWVudElkICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBzdWNjZXNzZnVsXG4gIC8vICAgICAgICAgICAgICAgICogc3Vic2NyaXB0aW9uICAgICAgICAgICAgICAgICAgICAgICAqIGNsaWVudElkXG4gIC8vIE1BWSBpbmNsdWRlOiAgICogZXh0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIHN1YnNjcmlwdGlvblxuICAvLyAgICAgICAgICAgICAgICAqIGlkICAgICAgICAgICAgICAgICAgTUFZIGluY2x1ZGU6ICAgKiBlcnJvclxuICAvLyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKiBhZHZpY2VcbiAgLy8gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogZXh0XG4gIC8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIGlkXG4gIC8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIHRpbWVzdGFtcFxuICB1bnN1YnNjcmliZTogZnVuY3Rpb24oY2hhbm5lbCwgc3Vic2NyaXB0aW9uKSB7XG4gICAgaWYgKGNoYW5uZWwgaW5zdGFuY2VvZiBBcnJheSlcbiAgICAgIHJldHVybiBhcnJheS5tYXAoY2hhbm5lbCwgZnVuY3Rpb24oYykge1xuICAgICAgICByZXR1cm4gdGhpcy51bnN1YnNjcmliZShjLCBzdWJzY3JpcHRpb24pO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICB2YXIgZGVhZCA9IHRoaXMuX2NoYW5uZWxzLnVuc3Vic2NyaWJlKGNoYW5uZWwsIHN1YnNjcmlwdGlvbik7XG4gICAgaWYgKCFkZWFkKSByZXR1cm47XG5cbiAgICB0aGlzLmNvbm5lY3QoZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmluZm8oJ0NsaWVudCA/IGF0dGVtcHRpbmcgdG8gdW5zdWJzY3JpYmUgZnJvbSA/JywgdGhpcy5fZGlzcGF0Y2hlci5jbGllbnRJZCwgY2hhbm5lbCk7XG5cbiAgICAgIHRoaXMuX3NlbmRNZXNzYWdlKHtcbiAgICAgICAgY2hhbm5lbDogICAgICBDaGFubmVsLlVOU1VCU0NSSUJFLFxuICAgICAgICBjbGllbnRJZDogICAgIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQsXG4gICAgICAgIHN1YnNjcmlwdGlvbjogY2hhbm5lbFxuXG4gICAgICB9LCB7fSwgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgaWYgKCFyZXNwb25zZS5zdWNjZXNzZnVsKSByZXR1cm47XG5cbiAgICAgICAgdmFyIGNoYW5uZWxzID0gW10uY29uY2F0KHJlc3BvbnNlLnN1YnNjcmlwdGlvbik7XG4gICAgICAgIHRoaXMuaW5mbygnVW5zdWJzY3JpcHRpb24gYWNrbm93bGVkZ2VkIGZvciA/IGZyb20gPycsIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQsIGNoYW5uZWxzKTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH0sIHRoaXMpO1xuICB9LFxuXG4gIC8vIFJlcXVlc3QgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBSZXNwb25zZVxuICAvLyBNVVNUIGluY2x1ZGU6ICAqIGNoYW5uZWwgICAgICAgICAgICAgTVVTVCBpbmNsdWRlOiAgKiBjaGFubmVsXG4gIC8vICAgICAgICAgICAgICAgICogZGF0YSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqIHN1Y2Nlc3NmdWxcbiAgLy8gTUFZIGluY2x1ZGU6ICAgKiBjbGllbnRJZCAgICAgICAgICAgIE1BWSBpbmNsdWRlOiAgICogaWRcbiAgLy8gICAgICAgICAgICAgICAgKiBpZCAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogZXJyb3JcbiAgLy8gICAgICAgICAgICAgICAgKiBleHQgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICogZXh0XG4gIHB1Ymxpc2g6IGZ1bmN0aW9uKGNoYW5uZWwsIGRhdGEsIG9wdGlvbnMpIHtcbiAgICB2YWxpZGF0ZU9wdGlvbnMob3B0aW9ucyB8fCB7fSwgWydhdHRlbXB0cycsICdkZWFkbGluZSddKTtcbiAgICB2YXIgcHVibGljYXRpb24gPSBuZXcgUHVibGljYXRpb24oKTtcblxuICAgIHRoaXMuY29ubmVjdChmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuaW5mbygnQ2xpZW50ID8gcXVldWVpbmcgcHVibGlzaGVkIG1lc3NhZ2UgdG8gPzogPycsIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQsIGNoYW5uZWwsIGRhdGEpO1xuXG4gICAgICB0aGlzLl9zZW5kTWVzc2FnZSh7XG4gICAgICAgIGNoYW5uZWw6ICBjaGFubmVsLFxuICAgICAgICBkYXRhOiAgICAgZGF0YSxcbiAgICAgICAgY2xpZW50SWQ6IHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWRcblxuICAgICAgfSwgb3B0aW9ucywgZnVuY3Rpb24ocmVzcG9uc2UpIHtcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN1Y2Nlc3NmdWwpXG4gICAgICAgICAgcHVibGljYXRpb24uc2V0RGVmZXJyZWRTdGF0dXMoJ3N1Y2NlZWRlZCcpO1xuICAgICAgICBlbHNlXG4gICAgICAgICAgcHVibGljYXRpb24uc2V0RGVmZXJyZWRTdGF0dXMoJ2ZhaWxlZCcsIEVycm9yLnBhcnNlKHJlc3BvbnNlLmVycm9yKSk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9LCB0aGlzKTtcblxuICAgIHJldHVybiBwdWJsaWNhdGlvbjtcbiAgfSxcblxuICBfc2VuZE1lc3NhZ2U6IGZ1bmN0aW9uKG1lc3NhZ2UsIG9wdGlvbnMsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgbWVzc2FnZS5pZCA9IHRoaXMuX2dlbmVyYXRlTWVzc2FnZUlkKCk7XG5cbiAgICB2YXIgdGltZW91dCA9IHRoaXMuX2FkdmljZS50aW1lb3V0XG4gICAgICAgICAgICAgICAgPyAxLjIgKiB0aGlzLl9hZHZpY2UudGltZW91dCAvIDEwMDBcbiAgICAgICAgICAgICAgICA6IDEuMiAqIHRoaXMuX2Rpc3BhdGNoZXIucmV0cnk7XG5cbiAgICB0aGlzLnBpcGVUaHJvdWdoRXh0ZW5zaW9ucygnb3V0Z29pbmcnLCBtZXNzYWdlLCBudWxsLCBmdW5jdGlvbihtZXNzYWdlKSB7XG4gICAgICBpZiAoIW1lc3NhZ2UpIHJldHVybjtcbiAgICAgIGlmIChjYWxsYmFjaykgdGhpcy5fcmVzcG9uc2VDYWxsYmFja3NbbWVzc2FnZS5pZF0gPSBbY2FsbGJhY2ssIGNvbnRleHRdO1xuICAgICAgdGhpcy5fZGlzcGF0Y2hlci5zZW5kTWVzc2FnZShtZXNzYWdlLCB0aW1lb3V0LCBvcHRpb25zIHx8IHt9KTtcbiAgICB9LCB0aGlzKTtcbiAgfSxcblxuICBfZ2VuZXJhdGVNZXNzYWdlSWQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX21lc3NhZ2VJZCArPSAxO1xuICAgIGlmICh0aGlzLl9tZXNzYWdlSWQgPj0gTWF0aC5wb3coMiwzMikpIHRoaXMuX21lc3NhZ2VJZCA9IDA7XG4gICAgcmV0dXJuIHRoaXMuX21lc3NhZ2VJZC50b1N0cmluZygzNik7XG4gIH0sXG5cbiAgX3JlY2VpdmVNZXNzYWdlOiBmdW5jdGlvbihtZXNzYWdlKSB7XG4gICAgdmFyIGlkID0gbWVzc2FnZS5pZCwgY2FsbGJhY2s7XG5cbiAgICBpZiAobWVzc2FnZS5zdWNjZXNzZnVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNhbGxiYWNrID0gdGhpcy5fcmVzcG9uc2VDYWxsYmFja3NbaWRdO1xuICAgICAgZGVsZXRlIHRoaXMuX3Jlc3BvbnNlQ2FsbGJhY2tzW2lkXTtcbiAgICB9XG5cbiAgICB0aGlzLnBpcGVUaHJvdWdoRXh0ZW5zaW9ucygnaW5jb21pbmcnLCBtZXNzYWdlLCBudWxsLCBmdW5jdGlvbihtZXNzYWdlKSB7XG4gICAgICBpZiAoIW1lc3NhZ2UpIHJldHVybjtcbiAgICAgIGlmIChtZXNzYWdlLmFkdmljZSkgdGhpcy5faGFuZGxlQWR2aWNlKG1lc3NhZ2UuYWR2aWNlKTtcbiAgICAgIHRoaXMuX2RlbGl2ZXJNZXNzYWdlKG1lc3NhZ2UpO1xuICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFja1swXS5jYWxsKGNhbGxiYWNrWzFdLCBtZXNzYWdlKTtcbiAgICB9LCB0aGlzKTtcbiAgfSxcblxuICBfaGFuZGxlQWR2aWNlOiBmdW5jdGlvbihhZHZpY2UpIHtcbiAgICBleHRlbmQodGhpcy5fYWR2aWNlLCBhZHZpY2UpO1xuICAgIHRoaXMuX2Rpc3BhdGNoZXIudGltZW91dCA9IHRoaXMuX2FkdmljZS50aW1lb3V0IC8gMTAwMDtcblxuICAgIGlmICh0aGlzLl9hZHZpY2UucmVjb25uZWN0ID09PSB0aGlzLkhBTkRTSEFLRSAmJiB0aGlzLl9zdGF0ZSAhPT0gdGhpcy5ESVNDT05ORUNURUQpIHtcbiAgICAgIHRoaXMuX3N0YXRlID0gdGhpcy5VTkNPTk5FQ1RFRDtcbiAgICAgIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQgPSBudWxsO1xuICAgICAgdGhpcy5fY3ljbGVDb25uZWN0aW9uKCk7XG4gICAgfVxuICB9LFxuXG4gIF9kZWxpdmVyTWVzc2FnZTogZnVuY3Rpb24obWVzc2FnZSkge1xuICAgIGlmICghbWVzc2FnZS5jaGFubmVsIHx8IG1lc3NhZ2UuZGF0YSA9PT0gdW5kZWZpbmVkKSByZXR1cm47XG4gICAgdGhpcy5pbmZvKCdDbGllbnQgPyBjYWxsaW5nIGxpc3RlbmVycyBmb3IgPyB3aXRoID8nLCB0aGlzLl9kaXNwYXRjaGVyLmNsaWVudElkLCBtZXNzYWdlLmNoYW5uZWwsIG1lc3NhZ2UuZGF0YSk7XG4gICAgdGhpcy5fY2hhbm5lbHMuZGlzdHJpYnV0ZU1lc3NhZ2UobWVzc2FnZSk7XG4gIH0sXG5cbiAgX2N5Y2xlQ29ubmVjdGlvbjogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuX2Nvbm5lY3RSZXF1ZXN0KSB7XG4gICAgICB0aGlzLl9jb25uZWN0UmVxdWVzdCA9IG51bGw7XG4gICAgICB0aGlzLmluZm8oJ0Nsb3NlZCBjb25uZWN0aW9uIGZvciA/JywgdGhpcy5fZGlzcGF0Y2hlci5jbGllbnRJZCk7XG4gICAgfVxuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICBnbG9iYWwuc2V0VGltZW91dChmdW5jdGlvbigpIHsgc2VsZi5jb25uZWN0KCkgfSwgdGhpcy5fYWR2aWNlLmludGVydmFsKTtcbiAgfVxufSk7XG5cbmV4dGVuZChDbGllbnQucHJvdG90eXBlLCBEZWZlcnJhYmxlKTtcbmV4dGVuZChDbGllbnQucHJvdG90eXBlLCBQdWJsaXNoZXIpO1xuZXh0ZW5kKENsaWVudC5wcm90b3R5cGUsIExvZ2dpbmcpO1xuZXh0ZW5kKENsaWVudC5wcm90b3R5cGUsIEV4dGVuc2libGUpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENsaWVudDtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIENsYXNzICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvY2xhc3MnKSxcbiAgICBVUkkgICAgICAgPSByZXF1aXJlKCcuLi91dGlsL3VyaScpLFxuICAgIGNvb2tpZXMgICA9IHJlcXVpcmUoJy4uL3V0aWwvY29va2llcycpLFxuICAgIGV4dGVuZCAgICA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kJyksXG4gICAgTG9nZ2luZyAgID0gcmVxdWlyZSgnLi4vbWl4aW5zL2xvZ2dpbmcnKSxcbiAgICBQdWJsaXNoZXIgPSByZXF1aXJlKCcuLi9taXhpbnMvcHVibGlzaGVyJyksXG4gICAgVHJhbnNwb3J0ID0gcmVxdWlyZSgnLi4vdHJhbnNwb3J0JyksXG4gICAgU2NoZWR1bGVyID0gcmVxdWlyZSgnLi9zY2hlZHVsZXInKTtcblxudmFyIERpc3BhdGNoZXIgPSBDbGFzcyh7IGNsYXNzTmFtZTogJ0Rpc3BhdGNoZXInLFxuICBNQVhfUkVRVUVTVF9TSVpFOiAyMDQ4LFxuICBERUZBVUxUX1JFVFJZOiAgICA1LFxuXG4gIFVQOiAgIDEsXG4gIERPV046IDIsXG5cbiAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oY2xpZW50LCBlbmRwb2ludCwgb3B0aW9ucykge1xuICAgIHRoaXMuX2NsaWVudCAgICAgPSBjbGllbnQ7XG4gICAgdGhpcy5lbmRwb2ludCAgICA9IFVSSS5wYXJzZShlbmRwb2ludCk7XG4gICAgdGhpcy5fYWx0ZXJuYXRlcyA9IG9wdGlvbnMuZW5kcG9pbnRzIHx8IHt9O1xuXG4gICAgdGhpcy5jb29raWVzICAgICAgPSBjb29raWVzLkNvb2tpZUphciAmJiBuZXcgY29va2llcy5Db29raWVKYXIoKTtcbiAgICB0aGlzLl9kaXNhYmxlZCAgICA9IFtdO1xuICAgIHRoaXMuX2VudmVsb3BlcyAgID0ge307XG4gICAgdGhpcy5oZWFkZXJzICAgICAgPSB7fTtcbiAgICB0aGlzLnJldHJ5ICAgICAgICA9IG9wdGlvbnMucmV0cnkgfHwgdGhpcy5ERUZBVUxUX1JFVFJZO1xuICAgIHRoaXMuX3NjaGVkdWxlciAgID0gb3B0aW9ucy5zY2hlZHVsZXIgfHwgU2NoZWR1bGVyO1xuICAgIHRoaXMuX3N0YXRlICAgICAgID0gMDtcbiAgICB0aGlzLnRyYW5zcG9ydHMgICA9IHt9O1xuICAgIHRoaXMud3NFeHRlbnNpb25zID0gW107XG5cbiAgICB0aGlzLnByb3h5ID0gb3B0aW9ucy5wcm94eSB8fCB7fTtcbiAgICBpZiAodHlwZW9mIHRoaXMuX3Byb3h5ID09PSAnc3RyaW5nJykgdGhpcy5fcHJveHkgPSB7b3JpZ2luOiB0aGlzLl9wcm94eX07XG5cbiAgICB2YXIgZXh0cyA9IG9wdGlvbnMud2Vic29ja2V0RXh0ZW5zaW9ucztcbiAgICBpZiAoZXh0cykge1xuICAgICAgZXh0cyA9IFtdLmNvbmNhdChleHRzKTtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gZXh0cy5sZW5ndGg7IGkgPCBuOyBpKyspXG4gICAgICAgIHRoaXMuYWRkV2Vic29ja2V0RXh0ZW5zaW9uKGV4dHNbaV0pO1xuICAgIH1cblxuICAgIHRoaXMudGxzID0gb3B0aW9ucy50bHMgfHwge307XG4gICAgdGhpcy50bHMuY2EgPSB0aGlzLnRscy5jYSB8fCBvcHRpb25zLmNhO1xuXG4gICAgZm9yICh2YXIgdHlwZSBpbiB0aGlzLl9hbHRlcm5hdGVzKVxuICAgICAgdGhpcy5fYWx0ZXJuYXRlc1t0eXBlXSA9IFVSSS5wYXJzZSh0aGlzLl9hbHRlcm5hdGVzW3R5cGVdKTtcblxuICAgIHRoaXMubWF4UmVxdWVzdFNpemUgPSB0aGlzLk1BWF9SRVFVRVNUX1NJWkU7XG4gIH0sXG5cbiAgZW5kcG9pbnRGb3I6IGZ1bmN0aW9uKGNvbm5lY3Rpb25UeXBlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FsdGVybmF0ZXNbY29ubmVjdGlvblR5cGVdIHx8IHRoaXMuZW5kcG9pbnQ7XG4gIH0sXG5cbiAgYWRkV2Vic29ja2V0RXh0ZW5zaW9uOiBmdW5jdGlvbihleHRlbnNpb24pIHtcbiAgICB0aGlzLndzRXh0ZW5zaW9ucy5wdXNoKGV4dGVuc2lvbik7XG4gIH0sXG5cbiAgZGlzYWJsZTogZnVuY3Rpb24oZmVhdHVyZSkge1xuICAgIHRoaXMuX2Rpc2FibGVkLnB1c2goZmVhdHVyZSk7XG4gIH0sXG5cbiAgc2V0SGVhZGVyOiBmdW5jdGlvbihuYW1lLCB2YWx1ZSkge1xuICAgIHRoaXMuaGVhZGVyc1tuYW1lXSA9IHZhbHVlO1xuICB9LFxuXG4gIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdHJhbnNwb3J0ID0gdGhpcy5fdHJhbnNwb3J0O1xuICAgIGRlbGV0ZSB0aGlzLl90cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCkgdHJhbnNwb3J0LmNsb3NlKCk7XG4gIH0sXG5cbiAgZ2V0Q29ubmVjdGlvblR5cGVzOiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gVHJhbnNwb3J0LmdldENvbm5lY3Rpb25UeXBlcygpO1xuICB9LFxuXG4gIHNlbGVjdFRyYW5zcG9ydDogZnVuY3Rpb24odHJhbnNwb3J0VHlwZXMpIHtcbiAgICBUcmFuc3BvcnQuZ2V0KHRoaXMsIHRyYW5zcG9ydFR5cGVzLCB0aGlzLl9kaXNhYmxlZCwgZnVuY3Rpb24odHJhbnNwb3J0KSB7XG4gICAgICB0aGlzLmRlYnVnKCdTZWxlY3RlZCA/IHRyYW5zcG9ydCBmb3IgPycsIHRyYW5zcG9ydC5jb25uZWN0aW9uVHlwZSwgVVJJLnN0cmluZ2lmeSh0cmFuc3BvcnQuZW5kcG9pbnQpKTtcblxuICAgICAgaWYgKHRyYW5zcG9ydCA9PT0gdGhpcy5fdHJhbnNwb3J0KSByZXR1cm47XG4gICAgICBpZiAodGhpcy5fdHJhbnNwb3J0KSB0aGlzLl90cmFuc3BvcnQuY2xvc2UoKTtcblxuICAgICAgdGhpcy5fdHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuICAgICAgdGhpcy5jb25uZWN0aW9uVHlwZSA9IHRyYW5zcG9ydC5jb25uZWN0aW9uVHlwZTtcbiAgICB9LCB0aGlzKTtcbiAgfSxcblxuICBzZW5kTWVzc2FnZTogZnVuY3Rpb24obWVzc2FnZSwgdGltZW91dCwgb3B0aW9ucykge1xuICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgdmFyIGlkICAgICAgID0gbWVzc2FnZS5pZCxcbiAgICAgICAgYXR0ZW1wdHMgPSBvcHRpb25zLmF0dGVtcHRzLFxuICAgICAgICBkZWFkbGluZSA9IG9wdGlvbnMuZGVhZGxpbmUgJiYgbmV3IERhdGUoKS5nZXRUaW1lKCkgKyAob3B0aW9ucy5kZWFkbGluZSAqIDEwMDApLFxuICAgICAgICBlbnZlbG9wZSA9IHRoaXMuX2VudmVsb3Blc1tpZF0sXG4gICAgICAgIHNjaGVkdWxlcjtcblxuICAgIGlmICghZW52ZWxvcGUpIHtcbiAgICAgIHNjaGVkdWxlciA9IG5ldyB0aGlzLl9zY2hlZHVsZXIobWVzc2FnZSwge3RpbWVvdXQ6IHRpbWVvdXQsIGludGVydmFsOiB0aGlzLnJldHJ5LCBhdHRlbXB0czogYXR0ZW1wdHMsIGRlYWRsaW5lOiBkZWFkbGluZX0pO1xuICAgICAgZW52ZWxvcGUgID0gdGhpcy5fZW52ZWxvcGVzW2lkXSA9IHttZXNzYWdlOiBtZXNzYWdlLCBzY2hlZHVsZXI6IHNjaGVkdWxlcn07XG4gICAgfVxuXG4gICAgdGhpcy5fc2VuZEVudmVsb3BlKGVudmVsb3BlKTtcbiAgfSxcblxuICBfc2VuZEVudmVsb3BlOiBmdW5jdGlvbihlbnZlbG9wZSkge1xuICAgIGlmICghdGhpcy5fdHJhbnNwb3J0KSByZXR1cm47XG4gICAgaWYgKGVudmVsb3BlLnJlcXVlc3QgfHwgZW52ZWxvcGUudGltZXIpIHJldHVybjtcblxuICAgIHZhciBtZXNzYWdlICAgPSBlbnZlbG9wZS5tZXNzYWdlLFxuICAgICAgICBzY2hlZHVsZXIgPSBlbnZlbG9wZS5zY2hlZHVsZXIsXG4gICAgICAgIHNlbGYgICAgICA9IHRoaXM7XG5cbiAgICBpZiAoIXNjaGVkdWxlci5pc0RlbGl2ZXJhYmxlKCkpIHtcbiAgICAgIHNjaGVkdWxlci5hYm9ydCgpO1xuICAgICAgZGVsZXRlIHRoaXMuX2VudmVsb3Blc1ttZXNzYWdlLmlkXTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBlbnZlbG9wZS50aW1lciA9IGdsb2JhbC5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgc2VsZi5oYW5kbGVFcnJvcihtZXNzYWdlKTtcbiAgICB9LCBzY2hlZHVsZXIuZ2V0VGltZW91dCgpICogMTAwMCk7XG5cbiAgICBzY2hlZHVsZXIuc2VuZCgpO1xuICAgIGVudmVsb3BlLnJlcXVlc3QgPSB0aGlzLl90cmFuc3BvcnQuc2VuZE1lc3NhZ2UobWVzc2FnZSk7XG4gIH0sXG5cbiAgaGFuZGxlUmVzcG9uc2U6IGZ1bmN0aW9uKHJlcGx5KSB7XG4gICAgdmFyIGVudmVsb3BlID0gdGhpcy5fZW52ZWxvcGVzW3JlcGx5LmlkXTtcblxuICAgIGlmIChyZXBseS5zdWNjZXNzZnVsICE9PSB1bmRlZmluZWQgJiYgZW52ZWxvcGUpIHtcbiAgICAgIGVudmVsb3BlLnNjaGVkdWxlci5zdWNjZWVkKCk7XG4gICAgICBkZWxldGUgdGhpcy5fZW52ZWxvcGVzW3JlcGx5LmlkXTtcbiAgICAgIGdsb2JhbC5jbGVhclRpbWVvdXQoZW52ZWxvcGUudGltZXIpO1xuICAgIH1cblxuICAgIHRoaXMudHJpZ2dlcignbWVzc2FnZScsIHJlcGx5KTtcblxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gdGhpcy5VUCkgcmV0dXJuO1xuICAgIHRoaXMuX3N0YXRlID0gdGhpcy5VUDtcbiAgICB0aGlzLl9jbGllbnQudHJpZ2dlcigndHJhbnNwb3J0OnVwJyk7XG4gIH0sXG5cbiAgaGFuZGxlRXJyb3I6IGZ1bmN0aW9uKG1lc3NhZ2UsIGltbWVkaWF0ZSkge1xuICAgIHZhciBlbnZlbG9wZSA9IHRoaXMuX2VudmVsb3Blc1ttZXNzYWdlLmlkXSxcbiAgICAgICAgcmVxdWVzdCAgPSBlbnZlbG9wZSAmJiBlbnZlbG9wZS5yZXF1ZXN0LFxuICAgICAgICBzZWxmICAgICA9IHRoaXM7XG5cbiAgICBpZiAoIXJlcXVlc3QpIHJldHVybjtcblxuICAgIHJlcXVlc3QudGhlbihmdW5jdGlvbihyZXEpIHtcbiAgICAgIGlmIChyZXEgJiYgcmVxLmFib3J0KSByZXEuYWJvcnQoKTtcbiAgICB9KTtcblxuICAgIHZhciBzY2hlZHVsZXIgPSBlbnZlbG9wZS5zY2hlZHVsZXI7XG4gICAgc2NoZWR1bGVyLmZhaWwoKTtcblxuICAgIGdsb2JhbC5jbGVhclRpbWVvdXQoZW52ZWxvcGUudGltZXIpO1xuICAgIGVudmVsb3BlLnJlcXVlc3QgPSBlbnZlbG9wZS50aW1lciA9IG51bGw7XG5cbiAgICBpZiAoaW1tZWRpYXRlKSB7XG4gICAgICB0aGlzLl9zZW5kRW52ZWxvcGUoZW52ZWxvcGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBlbnZlbG9wZS50aW1lciA9IGdsb2JhbC5zZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBlbnZlbG9wZS50aW1lciA9IG51bGw7XG4gICAgICAgIHNlbGYuX3NlbmRFbnZlbG9wZShlbnZlbG9wZSk7XG4gICAgICB9LCBzY2hlZHVsZXIuZ2V0SW50ZXJ2YWwoKSAqIDEwMDApO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9zdGF0ZSA9PT0gdGhpcy5ET1dOKSByZXR1cm47XG4gICAgdGhpcy5fc3RhdGUgPSB0aGlzLkRPV047XG4gICAgdGhpcy5fY2xpZW50LnRyaWdnZXIoJ3RyYW5zcG9ydDpkb3duJyk7XG4gIH1cbn0pO1xuXG5EaXNwYXRjaGVyLmNyZWF0ZSA9IGZ1bmN0aW9uKGNsaWVudCwgZW5kcG9pbnQsIG9wdGlvbnMpIHtcbiAgcmV0dXJuIG5ldyBEaXNwYXRjaGVyKGNsaWVudCwgZW5kcG9pbnQsIG9wdGlvbnMpO1xufTtcblxuZXh0ZW5kKERpc3BhdGNoZXIucHJvdG90eXBlLCBQdWJsaXNoZXIpO1xuZXh0ZW5kKERpc3BhdGNoZXIucHJvdG90eXBlLCBMb2dnaW5nKTtcblxubW9kdWxlLmV4cG9ydHMgPSBEaXNwYXRjaGVyO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ2xhc3MgICA9IHJlcXVpcmUoJy4uL3V0aWwvY2xhc3MnKSxcbiAgICBHcmFtbWFyID0gcmVxdWlyZSgnLi9ncmFtbWFyJyk7XG5cbnZhciBFcnJvciA9IENsYXNzKHtcbiAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oY29kZSwgcGFyYW1zLCBtZXNzYWdlKSB7XG4gICAgdGhpcy5jb2RlICAgID0gY29kZTtcbiAgICB0aGlzLnBhcmFtcyAgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChwYXJhbXMpO1xuICAgIHRoaXMubWVzc2FnZSA9IG1lc3NhZ2U7XG4gIH0sXG5cbiAgdG9TdHJpbmc6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLmNvZGUgKyAnOicgK1xuICAgICAgICAgICB0aGlzLnBhcmFtcy5qb2luKCcsJykgKyAnOicgK1xuICAgICAgICAgICB0aGlzLm1lc3NhZ2U7XG4gIH1cbn0pO1xuXG5FcnJvci5wYXJzZSA9IGZ1bmN0aW9uKG1lc3NhZ2UpIHtcbiAgbWVzc2FnZSA9IG1lc3NhZ2UgfHwgJyc7XG4gIGlmICghR3JhbW1hci5FUlJPUi50ZXN0KG1lc3NhZ2UpKSByZXR1cm4gbmV3IEVycm9yKG51bGwsIFtdLCBtZXNzYWdlKTtcblxuICB2YXIgcGFydHMgICA9IG1lc3NhZ2Uuc3BsaXQoJzonKSxcbiAgICAgIGNvZGUgICAgPSBwYXJzZUludChwYXJ0c1swXSksXG4gICAgICBwYXJhbXMgID0gcGFydHNbMV0uc3BsaXQoJywnKSxcbiAgICAgIG1lc3NhZ2UgPSBwYXJ0c1syXTtcblxuICByZXR1cm4gbmV3IEVycm9yKGNvZGUsIHBhcmFtcywgbWVzc2FnZSk7XG59O1xuXG4vLyBodHRwOi8vY29kZS5nb29nbGUuY29tL3AvY29tZXRkL3dpa2kvQmF5ZXV4Q29kZXNcbnZhciBlcnJvcnMgPSB7XG4gIHZlcnNpb25NaXNtYXRjaDogIFszMDAsICdWZXJzaW9uIG1pc21hdGNoJ10sXG4gIGNvbm50eXBlTWlzbWF0Y2g6IFszMDEsICdDb25uZWN0aW9uIHR5cGVzIG5vdCBzdXBwb3J0ZWQnXSxcbiAgZXh0TWlzbWF0Y2g6ICAgICAgWzMwMiwgJ0V4dGVuc2lvbiBtaXNtYXRjaCddLFxuICBiYWRSZXF1ZXN0OiAgICAgICBbNDAwLCAnQmFkIHJlcXVlc3QnXSxcbiAgY2xpZW50VW5rbm93bjogICAgWzQwMSwgJ1Vua25vd24gY2xpZW50J10sXG4gIHBhcmFtZXRlck1pc3Npbmc6IFs0MDIsICdNaXNzaW5nIHJlcXVpcmVkIHBhcmFtZXRlciddLFxuICBjaGFubmVsRm9yYmlkZGVuOiBbNDAzLCAnRm9yYmlkZGVuIGNoYW5uZWwnXSxcbiAgY2hhbm5lbFVua25vd246ICAgWzQwNCwgJ1Vua25vd24gY2hhbm5lbCddLFxuICBjaGFubmVsSW52YWxpZDogICBbNDA1LCAnSW52YWxpZCBjaGFubmVsJ10sXG4gIGV4dFVua25vd246ICAgICAgIFs0MDYsICdVbmtub3duIGV4dGVuc2lvbiddLFxuICBwdWJsaXNoRmFpbGVkOiAgICBbNDA3LCAnRmFpbGVkIHRvIHB1Ymxpc2gnXSxcbiAgc2VydmVyRXJyb3I6ICAgICAgWzUwMCwgJ0ludGVybmFsIHNlcnZlciBlcnJvciddXG59O1xuXG5mb3IgKHZhciBuYW1lIGluIGVycm9ycylcbiAgKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBFcnJvcltuYW1lXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgcmV0dXJuIG5ldyBFcnJvcihlcnJvcnNbbmFtZV1bMF0sIGFyZ3VtZW50cywgZXJyb3JzW25hbWVdWzFdKS50b1N0cmluZygpO1xuICAgIH07XG4gIH0pKG5hbWUpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVycm9yO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kICA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kJyksXG4gICAgTG9nZ2luZyA9IHJlcXVpcmUoJy4uL21peGlucy9sb2dnaW5nJyk7XG5cbnZhciBFeHRlbnNpYmxlID0ge1xuICBhZGRFeHRlbnNpb246IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xuICAgIHRoaXMuX2V4dGVuc2lvbnMgPSB0aGlzLl9leHRlbnNpb25zIHx8IFtdO1xuICAgIHRoaXMuX2V4dGVuc2lvbnMucHVzaChleHRlbnNpb24pO1xuICAgIGlmIChleHRlbnNpb24uYWRkZWQpIGV4dGVuc2lvbi5hZGRlZCh0aGlzKTtcbiAgfSxcblxuICByZW1vdmVFeHRlbnNpb246IGZ1bmN0aW9uKGV4dGVuc2lvbikge1xuICAgIGlmICghdGhpcy5fZXh0ZW5zaW9ucykgcmV0dXJuO1xuICAgIHZhciBpID0gdGhpcy5fZXh0ZW5zaW9ucy5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSkge1xuICAgICAgaWYgKHRoaXMuX2V4dGVuc2lvbnNbaV0gIT09IGV4dGVuc2lvbikgY29udGludWU7XG4gICAgICB0aGlzLl9leHRlbnNpb25zLnNwbGljZShpLDEpO1xuICAgICAgaWYgKGV4dGVuc2lvbi5yZW1vdmVkKSBleHRlbnNpb24ucmVtb3ZlZCh0aGlzKTtcbiAgICB9XG4gIH0sXG5cbiAgcGlwZVRocm91Z2hFeHRlbnNpb25zOiBmdW5jdGlvbihzdGFnZSwgbWVzc2FnZSwgcmVxdWVzdCwgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICB0aGlzLmRlYnVnKCdQYXNzaW5nIHRocm91Z2ggPyBleHRlbnNpb25zOiA/Jywgc3RhZ2UsIG1lc3NhZ2UpO1xuXG4gICAgaWYgKCF0aGlzLl9leHRlbnNpb25zKSByZXR1cm4gY2FsbGJhY2suY2FsbChjb250ZXh0LCBtZXNzYWdlKTtcbiAgICB2YXIgZXh0ZW5zaW9ucyA9IHRoaXMuX2V4dGVuc2lvbnMuc2xpY2UoKTtcblxuICAgIHZhciBwaXBlID0gZnVuY3Rpb24obWVzc2FnZSkge1xuICAgICAgaWYgKCFtZXNzYWdlKSByZXR1cm4gY2FsbGJhY2suY2FsbChjb250ZXh0LCBtZXNzYWdlKTtcblxuICAgICAgdmFyIGV4dGVuc2lvbiA9IGV4dGVuc2lvbnMuc2hpZnQoKTtcbiAgICAgIGlmICghZXh0ZW5zaW9uKSByZXR1cm4gY2FsbGJhY2suY2FsbChjb250ZXh0LCBtZXNzYWdlKTtcblxuICAgICAgdmFyIGZuID0gZXh0ZW5zaW9uW3N0YWdlXTtcbiAgICAgIGlmICghZm4pIHJldHVybiBwaXBlKG1lc3NhZ2UpO1xuXG4gICAgICBpZiAoZm4ubGVuZ3RoID49IDMpIGV4dGVuc2lvbltzdGFnZV0obWVzc2FnZSwgcmVxdWVzdCwgcGlwZSk7XG4gICAgICBlbHNlICAgICAgICAgICAgICAgIGV4dGVuc2lvbltzdGFnZV0obWVzc2FnZSwgcGlwZSk7XG4gICAgfTtcbiAgICBwaXBlKG1lc3NhZ2UpO1xuICB9XG59O1xuXG5leHRlbmQoRXh0ZW5zaWJsZSwgTG9nZ2luZyk7XG5cbm1vZHVsZS5leHBvcnRzID0gRXh0ZW5zaWJsZTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIENIQU5ORUxfTkFNRTogICAgIC9eXFwvKCgoKFthLXpdfFtBLVpdKXxbMC05XSl8KFxcLXxcXF98XFwhfFxcfnxcXCh8XFwpfFxcJHxcXEApKSkrKFxcLygoKChbYS16XXxbQS1aXSl8WzAtOV0pfChcXC18XFxffFxcIXxcXH58XFwofFxcKXxcXCR8XFxAKSkpKykqJC8sXG4gIENIQU5ORUxfUEFUVEVSTjogIC9eKFxcLygoKChbYS16XXxbQS1aXSl8WzAtOV0pfChcXC18XFxffFxcIXxcXH58XFwofFxcKXxcXCR8XFxAKSkpKykqXFwvXFwqezEsMn0kLyxcbiAgRVJST1I6ICAgICAgICAgICAgL14oWzAtOV1bMC05XVswLTldOigoKChbYS16XXxbQS1aXSl8WzAtOV0pfChcXC18XFxffFxcIXxcXH58XFwofFxcKXxcXCR8XFxAKXwgfFxcL3xcXCp8XFwuKSkqKCwoKCgoW2Etel18W0EtWl0pfFswLTldKXwoXFwtfFxcX3xcXCF8XFx+fFxcKHxcXCl8XFwkfFxcQCl8IHxcXC98XFwqfFxcLikpKikqOigoKChbYS16XXxbQS1aXSl8WzAtOV0pfChcXC18XFxffFxcIXxcXH58XFwofFxcKXxcXCR8XFxAKXwgfFxcL3xcXCp8XFwuKSkqfFswLTldWzAtOV1bMC05XTo6KCgoKFthLXpdfFtBLVpdKXxbMC05XSl8KFxcLXxcXF98XFwhfFxcfnxcXCh8XFwpfFxcJHxcXEApfCB8XFwvfFxcKnxcXC4pKSopJC8sXG4gIFZFUlNJT046ICAgICAgICAgIC9eKFswLTldKSsoXFwuKChbYS16XXxbQS1aXSl8WzAtOV0pKCgoKFthLXpdfFtBLVpdKXxbMC05XSl8XFwtfFxcXykpKikqJC9cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBDbGFzcyAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9jbGFzcycpLFxuICAgIERlZmVycmFibGUgPSByZXF1aXJlKCcuLi9taXhpbnMvZGVmZXJyYWJsZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENsYXNzKERlZmVycmFibGUpO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmQnKTtcblxudmFyIFNjaGVkdWxlciA9IGZ1bmN0aW9uKG1lc3NhZ2UsIG9wdGlvbnMpIHtcbiAgdGhpcy5tZXNzYWdlICA9IG1lc3NhZ2U7XG4gIHRoaXMub3B0aW9ucyAgPSBvcHRpb25zO1xuICB0aGlzLmF0dGVtcHRzID0gMDtcbn07XG5cbmV4dGVuZChTY2hlZHVsZXIucHJvdG90eXBlLCB7XG4gIGdldFRpbWVvdXQ6IGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiB0aGlzLm9wdGlvbnMudGltZW91dDtcbiAgfSxcblxuICBnZXRJbnRlcnZhbDogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHRoaXMub3B0aW9ucy5pbnRlcnZhbDtcbiAgfSxcblxuICBpc0RlbGl2ZXJhYmxlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgYXR0ZW1wdHMgPSB0aGlzLm9wdGlvbnMuYXR0ZW1wdHMsXG4gICAgICAgIG1hZGUgICAgID0gdGhpcy5hdHRlbXB0cyxcbiAgICAgICAgZGVhZGxpbmUgPSB0aGlzLm9wdGlvbnMuZGVhZGxpbmUsXG4gICAgICAgIG5vdyAgICAgID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5cbiAgICBpZiAoYXR0ZW1wdHMgIT09IHVuZGVmaW5lZCAmJiBtYWRlID49IGF0dGVtcHRzKVxuICAgICAgcmV0dXJuIGZhbHNlO1xuXG4gICAgaWYgKGRlYWRsaW5lICE9PSB1bmRlZmluZWQgJiYgbm93ID4gZGVhZGxpbmUpXG4gICAgICByZXR1cm4gZmFsc2U7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBzZW5kOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmF0dGVtcHRzICs9IDE7XG4gIH0sXG5cbiAgc3VjY2VlZDogZnVuY3Rpb24oKSB7fSxcblxuICBmYWlsOiBmdW5jdGlvbigpIHt9LFxuXG4gIGFib3J0OiBmdW5jdGlvbigpIHt9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTY2hlZHVsZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBDbGFzcyAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9jbGFzcycpLFxuICAgIGV4dGVuZCAgICAgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZCcpLFxuICAgIERlZmVycmFibGUgPSByZXF1aXJlKCcuLi9taXhpbnMvZGVmZXJyYWJsZScpO1xuXG52YXIgU3Vic2NyaXB0aW9uID0gQ2xhc3Moe1xuICBpbml0aWFsaXplOiBmdW5jdGlvbihjbGllbnQsIGNoYW5uZWxzLCBjYWxsYmFjaywgY29udGV4dCkge1xuICAgIHRoaXMuX2NsaWVudCAgICA9IGNsaWVudDtcbiAgICB0aGlzLl9jaGFubmVscyAgPSBjaGFubmVscztcbiAgICB0aGlzLl9jYWxsYmFjayAgPSBjYWxsYmFjaztcbiAgICB0aGlzLl9jb250ZXh0ICAgPSBjb250ZXh0O1xuICAgIHRoaXMuX2NhbmNlbGxlZCA9IGZhbHNlO1xuICB9LFxuXG4gIHdpdGhDaGFubmVsOiBmdW5jdGlvbihjYWxsYmFjaywgY29udGV4dCkge1xuICAgIHRoaXMuX3dpdGhDaGFubmVsID0gW2NhbGxiYWNrLCBjb250ZXh0XTtcbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuICBhcHBseTogZnVuY3Rpb24oY29udGV4dCwgYXJncykge1xuICAgIHZhciBtZXNzYWdlID0gYXJnc1swXTtcblxuICAgIGlmICh0aGlzLl9jYWxsYmFjaylcbiAgICAgIHRoaXMuX2NhbGxiYWNrLmNhbGwodGhpcy5fY29udGV4dCwgbWVzc2FnZS5kYXRhKTtcblxuICAgIGlmICh0aGlzLl93aXRoQ2hhbm5lbClcbiAgICAgIHRoaXMuX3dpdGhDaGFubmVsWzBdLmNhbGwodGhpcy5fd2l0aENoYW5uZWxbMV0sIG1lc3NhZ2UuY2hhbm5lbCwgbWVzc2FnZS5kYXRhKTtcbiAgfSxcblxuICBjYW5jZWw6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLl9jYW5jZWxsZWQpIHJldHVybjtcbiAgICB0aGlzLl9jbGllbnQudW5zdWJzY3JpYmUodGhpcy5fY2hhbm5lbHMsIHRoaXMpO1xuICAgIHRoaXMuX2NhbmNlbGxlZCA9IHRydWU7XG4gIH0sXG5cbiAgdW5zdWJzY3JpYmU6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY2FuY2VsKCk7XG4gIH1cbn0pO1xuXG5leHRlbmQoU3Vic2NyaXB0aW9uLnByb3RvdHlwZSwgRGVmZXJyYWJsZSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU3Vic2NyaXB0aW9uO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgVHJhbnNwb3J0ID0gcmVxdWlyZSgnLi90cmFuc3BvcnQnKTtcblxuVHJhbnNwb3J0LnJlZ2lzdGVyKCd3ZWJzb2NrZXQnLCByZXF1aXJlKCcuL3dlYl9zb2NrZXQnKSk7XG5UcmFuc3BvcnQucmVnaXN0ZXIoJ2V2ZW50c291cmNlJywgcmVxdWlyZSgnLi9ldmVudF9zb3VyY2UnKSk7XG5UcmFuc3BvcnQucmVnaXN0ZXIoJ2xvbmctcG9sbGluZycsIHJlcXVpcmUoJy4veGhyJykpO1xuVHJhbnNwb3J0LnJlZ2lzdGVyKCdjcm9zcy1vcmlnaW4tbG9uZy1wb2xsaW5nJywgcmVxdWlyZSgnLi9jb3JzJykpO1xuVHJhbnNwb3J0LnJlZ2lzdGVyKCdjYWxsYmFjay1wb2xsaW5nJywgcmVxdWlyZSgnLi9qc29ucCcpKTtcblxubW9kdWxlLmV4cG9ydHMgPSBUcmFuc3BvcnQ7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBDbGFzcyAgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgU2V0ICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9zZXQnKSxcbiAgICBVUkkgICAgICAgPSByZXF1aXJlKCcuLi91dGlsL3VyaScpLFxuICAgIGV4dGVuZCAgICA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kJyksXG4gICAgdG9KU09OICAgID0gcmVxdWlyZSgnLi4vdXRpbC90b19qc29uJyksXG4gICAgVHJhbnNwb3J0ID0gcmVxdWlyZSgnLi90cmFuc3BvcnQnKTtcblxudmFyIENPUlMgPSBleHRlbmQoQ2xhc3MoVHJhbnNwb3J0LCB7XG4gIGVuY29kZTogZnVuY3Rpb24obWVzc2FnZXMpIHtcbiAgICByZXR1cm4gJ21lc3NhZ2U9JyArIGVuY29kZVVSSUNvbXBvbmVudCh0b0pTT04obWVzc2FnZXMpKTtcbiAgfSxcblxuICByZXF1ZXN0OiBmdW5jdGlvbihtZXNzYWdlcykge1xuICAgIHZhciB4aHJDbGFzcyA9IGdsb2JhbC5YRG9tYWluUmVxdWVzdCA/IFhEb21haW5SZXF1ZXN0IDogWE1MSHR0cFJlcXVlc3QsXG4gICAgICAgIHhociAgICAgID0gbmV3IHhockNsYXNzKCksXG4gICAgICAgIGlkICAgICAgID0gKytDT1JTLl9pZCxcbiAgICAgICAgaGVhZGVycyAgPSB0aGlzLl9kaXNwYXRjaGVyLmhlYWRlcnMsXG4gICAgICAgIHNlbGYgICAgID0gdGhpcyxcbiAgICAgICAga2V5O1xuXG4gICAgeGhyLm9wZW4oJ1BPU1QnLCBVUkkuc3RyaW5naWZ5KHRoaXMuZW5kcG9pbnQpLCB0cnVlKTtcblxuICAgIGlmICh4aHIuc2V0UmVxdWVzdEhlYWRlcikge1xuICAgICAgeGhyLnNldFJlcXVlc3RIZWFkZXIoJ1ByYWdtYScsICduby1jYWNoZScpO1xuICAgICAgZm9yIChrZXkgaW4gaGVhZGVycykge1xuICAgICAgICBpZiAoIWhlYWRlcnMuaGFzT3duUHJvcGVydHkoa2V5KSkgY29udGludWU7XG4gICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGtleSwgaGVhZGVyc1trZXldKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YXIgY2xlYW5VcCA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCF4aHIpIHJldHVybiBmYWxzZTtcbiAgICAgIENPUlMuX3BlbmRpbmcucmVtb3ZlKGlkKTtcbiAgICAgIHhoci5vbmxvYWQgPSB4aHIub25lcnJvciA9IHhoci5vbnRpbWVvdXQgPSB4aHIub25wcm9ncmVzcyA9IG51bGw7XG4gICAgICB4aHIgPSBudWxsO1xuICAgIH07XG5cbiAgICB4aHIub25sb2FkID0gZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcmVwbGllcztcbiAgICAgIHRyeSB7IHJlcGxpZXMgPSBKU09OLnBhcnNlKHhoci5yZXNwb25zZVRleHQpIH0gY2F0Y2ggKGVycm9yKSB7fVxuXG4gICAgICBjbGVhblVwKCk7XG5cbiAgICAgIGlmIChyZXBsaWVzKVxuICAgICAgICBzZWxmLl9yZWNlaXZlKHJlcGxpZXMpO1xuICAgICAgZWxzZVxuICAgICAgICBzZWxmLl9oYW5kbGVFcnJvcihtZXNzYWdlcyk7XG4gICAgfTtcblxuICAgIHhoci5vbmVycm9yID0geGhyLm9udGltZW91dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgY2xlYW5VcCgpO1xuICAgICAgc2VsZi5faGFuZGxlRXJyb3IobWVzc2FnZXMpO1xuICAgIH07XG5cbiAgICB4aHIub25wcm9ncmVzcyA9IGZ1bmN0aW9uKCkge307XG5cbiAgICBpZiAoeGhyQ2xhc3MgPT09IGdsb2JhbC5YRG9tYWluUmVxdWVzdClcbiAgICAgIENPUlMuX3BlbmRpbmcuYWRkKHtpZDogaWQsIHhocjogeGhyfSk7XG5cbiAgICB4aHIuc2VuZCh0aGlzLmVuY29kZShtZXNzYWdlcykpO1xuICAgIHJldHVybiB4aHI7XG4gIH1cbn0pLCB7XG4gIF9pZDogICAgICAwLFxuICBfcGVuZGluZzogbmV3IFNldCgpLFxuXG4gIGlzVXNhYmxlOiBmdW5jdGlvbihkaXNwYXRjaGVyLCBlbmRwb2ludCwgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICBpZiAoVVJJLmlzU2FtZU9yaWdpbihlbmRwb2ludCkpXG4gICAgICByZXR1cm4gY2FsbGJhY2suY2FsbChjb250ZXh0LCBmYWxzZSk7XG5cbiAgICBpZiAoZ2xvYmFsLlhEb21haW5SZXF1ZXN0KVxuICAgICAgcmV0dXJuIGNhbGxiYWNrLmNhbGwoY29udGV4dCwgZW5kcG9pbnQucHJvdG9jb2wgPT09IGxvY2F0aW9uLnByb3RvY29sKTtcblxuICAgIGlmIChnbG9iYWwuWE1MSHR0cFJlcXVlc3QpIHtcbiAgICAgIHZhciB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICAgIHJldHVybiBjYWxsYmFjay5jYWxsKGNvbnRleHQsIHhoci53aXRoQ3JlZGVudGlhbHMgIT09IHVuZGVmaW5lZCk7XG4gICAgfVxuICAgIHJldHVybiBjYWxsYmFjay5jYWxsKGNvbnRleHQsIGZhbHNlKTtcbiAgfVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ09SUztcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIENsYXNzICAgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgVVJJICAgICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvdXJpJyksXG4gICAgY29weU9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvY29weV9vYmplY3QnKSxcbiAgICBleHRlbmQgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmQnKSxcbiAgICBEZWZlcnJhYmxlID0gcmVxdWlyZSgnLi4vbWl4aW5zL2RlZmVycmFibGUnKSxcbiAgICBUcmFuc3BvcnQgID0gcmVxdWlyZSgnLi90cmFuc3BvcnQnKSxcbiAgICBYSFIgICAgICAgID0gcmVxdWlyZSgnLi94aHInKTtcblxudmFyIEV2ZW50U291cmNlID0gZXh0ZW5kKENsYXNzKFRyYW5zcG9ydCwge1xuICBpbml0aWFsaXplOiBmdW5jdGlvbihkaXNwYXRjaGVyLCBlbmRwb2ludCkge1xuICAgIFRyYW5zcG9ydC5wcm90b3R5cGUuaW5pdGlhbGl6ZS5jYWxsKHRoaXMsIGRpc3BhdGNoZXIsIGVuZHBvaW50KTtcbiAgICBpZiAoIWdsb2JhbC5FdmVudFNvdXJjZSkgcmV0dXJuIHRoaXMuc2V0RGVmZXJyZWRTdGF0dXMoJ2ZhaWxlZCcpO1xuXG4gICAgdGhpcy5feGhyID0gbmV3IFhIUihkaXNwYXRjaGVyLCBlbmRwb2ludCk7XG5cbiAgICBlbmRwb2ludCA9IGNvcHlPYmplY3QoZW5kcG9pbnQpO1xuICAgIGVuZHBvaW50LnBhdGhuYW1lICs9ICcvJyArIGRpc3BhdGNoZXIuY2xpZW50SWQ7XG5cbiAgICB2YXIgc29ja2V0ID0gbmV3IGdsb2JhbC5FdmVudFNvdXJjZShVUkkuc3RyaW5naWZ5KGVuZHBvaW50KSksXG4gICAgICAgIHNlbGYgICA9IHRoaXM7XG5cbiAgICBzb2NrZXQub25vcGVuID0gZnVuY3Rpb24oKSB7XG4gICAgICBzZWxmLl9ldmVyQ29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgIHNlbGYuc2V0RGVmZXJyZWRTdGF0dXMoJ3N1Y2NlZWRlZCcpO1xuICAgIH07XG5cbiAgICBzb2NrZXQub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHNlbGYuX2V2ZXJDb25uZWN0ZWQpIHtcbiAgICAgICAgc2VsZi5faGFuZGxlRXJyb3IoW10pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5zZXREZWZlcnJlZFN0YXR1cygnZmFpbGVkJyk7XG4gICAgICAgIHNvY2tldC5jbG9zZSgpO1xuICAgICAgfVxuICAgIH07XG5cbiAgICBzb2NrZXQub25tZXNzYWdlID0gZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgIHZhciByZXBsaWVzO1xuICAgICAgdHJ5IHsgcmVwbGllcyA9IEpTT04ucGFyc2UoZXZlbnQuZGF0YSkgfSBjYXRjaCAoZXJyb3IpIHt9XG5cbiAgICAgIGlmIChyZXBsaWVzKVxuICAgICAgICBzZWxmLl9yZWNlaXZlKHJlcGxpZXMpO1xuICAgICAgZWxzZVxuICAgICAgICBzZWxmLl9oYW5kbGVFcnJvcihbXSk7XG4gICAgfTtcblxuICAgIHRoaXMuX3NvY2tldCA9IHNvY2tldDtcbiAgfSxcblxuICBjbG9zZTogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9zb2NrZXQpIHJldHVybjtcbiAgICB0aGlzLl9zb2NrZXQub25vcGVuID0gdGhpcy5fc29ja2V0Lm9uZXJyb3IgPSB0aGlzLl9zb2NrZXQub25tZXNzYWdlID0gbnVsbDtcbiAgICB0aGlzLl9zb2NrZXQuY2xvc2UoKTtcbiAgICBkZWxldGUgdGhpcy5fc29ja2V0O1xuICB9LFxuXG4gIGlzVXNhYmxlOiBmdW5jdGlvbihjYWxsYmFjaywgY29udGV4dCkge1xuICAgIHRoaXMuY2FsbGJhY2soZnVuY3Rpb24oKSB7IGNhbGxiYWNrLmNhbGwoY29udGV4dCwgdHJ1ZSkgfSk7XG4gICAgdGhpcy5lcnJiYWNrKGZ1bmN0aW9uKCkgeyBjYWxsYmFjay5jYWxsKGNvbnRleHQsIGZhbHNlKSB9KTtcbiAgfSxcblxuICBlbmNvZGU6IGZ1bmN0aW9uKG1lc3NhZ2VzKSB7XG4gICAgcmV0dXJuIHRoaXMuX3hoci5lbmNvZGUobWVzc2FnZXMpO1xuICB9LFxuXG4gIHJlcXVlc3Q6IGZ1bmN0aW9uKG1lc3NhZ2VzKSB7XG4gICAgcmV0dXJuIHRoaXMuX3hoci5yZXF1ZXN0KG1lc3NhZ2VzKTtcbiAgfVxuXG59KSwge1xuICBpc1VzYWJsZTogZnVuY3Rpb24oZGlzcGF0Y2hlciwgZW5kcG9pbnQsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgdmFyIGlkID0gZGlzcGF0Y2hlci5jbGllbnRJZDtcbiAgICBpZiAoIWlkKSByZXR1cm4gY2FsbGJhY2suY2FsbChjb250ZXh0LCBmYWxzZSk7XG5cbiAgICBYSFIuaXNVc2FibGUoZGlzcGF0Y2hlciwgZW5kcG9pbnQsIGZ1bmN0aW9uKHVzYWJsZSkge1xuICAgICAgaWYgKCF1c2FibGUpIHJldHVybiBjYWxsYmFjay5jYWxsKGNvbnRleHQsIGZhbHNlKTtcbiAgICAgIHRoaXMuY3JlYXRlKGRpc3BhdGNoZXIsIGVuZHBvaW50KS5pc1VzYWJsZShjYWxsYmFjaywgY29udGV4dCk7XG4gICAgfSwgdGhpcyk7XG4gIH0sXG5cbiAgY3JlYXRlOiBmdW5jdGlvbihkaXNwYXRjaGVyLCBlbmRwb2ludCkge1xuICAgIHZhciBzb2NrZXRzID0gZGlzcGF0Y2hlci50cmFuc3BvcnRzLmV2ZW50c291cmNlID0gZGlzcGF0Y2hlci50cmFuc3BvcnRzLmV2ZW50c291cmNlIHx8IHt9LFxuICAgICAgICBpZCAgICAgID0gZGlzcGF0Y2hlci5jbGllbnRJZDtcblxuICAgIHZhciB1cmwgPSBjb3B5T2JqZWN0KGVuZHBvaW50KTtcbiAgICB1cmwucGF0aG5hbWUgKz0gJy8nICsgKGlkIHx8ICcnKTtcbiAgICB1cmwgPSBVUkkuc3RyaW5naWZ5KHVybCk7XG5cbiAgICBzb2NrZXRzW3VybF0gPSBzb2NrZXRzW3VybF0gfHwgbmV3IHRoaXMoZGlzcGF0Y2hlciwgZW5kcG9pbnQpO1xuICAgIHJldHVybiBzb2NrZXRzW3VybF07XG4gIH1cbn0pO1xuXG5leHRlbmQoRXZlbnRTb3VyY2UucHJvdG90eXBlLCBEZWZlcnJhYmxlKTtcblxubW9kdWxlLmV4cG9ydHMgPSBFdmVudFNvdXJjZTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIENsYXNzICAgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgVVJJICAgICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvdXJpJyksXG4gICAgY29weU9iamVjdCA9IHJlcXVpcmUoJy4uL3V0aWwvY29weV9vYmplY3QnKSxcbiAgICBleHRlbmQgICAgID0gcmVxdWlyZSgnLi4vdXRpbC9leHRlbmQnKSxcbiAgICB0b0pTT04gICAgID0gcmVxdWlyZSgnLi4vdXRpbC90b19qc29uJyksXG4gICAgVHJhbnNwb3J0ICA9IHJlcXVpcmUoJy4vdHJhbnNwb3J0Jyk7XG5cbnZhciBKU09OUCA9IGV4dGVuZChDbGFzcyhUcmFuc3BvcnQsIHtcbiBlbmNvZGU6IGZ1bmN0aW9uKG1lc3NhZ2VzKSB7XG4gICAgdmFyIHVybCA9IGNvcHlPYmplY3QodGhpcy5lbmRwb2ludCk7XG4gICAgdXJsLnF1ZXJ5Lm1lc3NhZ2UgPSB0b0pTT04obWVzc2FnZXMpO1xuICAgIHVybC5xdWVyeS5qc29ucCAgID0gJ19fanNvbnAnICsgSlNPTlAuX2NiQ291bnQgKyAnX18nO1xuICAgIHJldHVybiBVUkkuc3RyaW5naWZ5KHVybCk7XG4gIH0sXG5cbiAgcmVxdWVzdDogZnVuY3Rpb24obWVzc2FnZXMpIHtcbiAgICB2YXIgaGVhZCAgICAgICAgID0gZG9jdW1lbnQuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ2hlYWQnKVswXSxcbiAgICAgICAgc2NyaXB0ICAgICAgID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnc2NyaXB0JyksXG4gICAgICAgIGNhbGxiYWNrTmFtZSA9IEpTT05QLmdldENhbGxiYWNrTmFtZSgpLFxuICAgICAgICBlbmRwb2ludCAgICAgPSBjb3B5T2JqZWN0KHRoaXMuZW5kcG9pbnQpLFxuICAgICAgICBzZWxmICAgICAgICAgPSB0aGlzO1xuXG4gICAgZW5kcG9pbnQucXVlcnkubWVzc2FnZSA9IHRvSlNPTihtZXNzYWdlcyk7XG4gICAgZW5kcG9pbnQucXVlcnkuanNvbnAgICA9IGNhbGxiYWNrTmFtZTtcblxuICAgIHZhciBjbGVhbnVwID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIWdsb2JhbFtjYWxsYmFja05hbWVdKSByZXR1cm4gZmFsc2U7XG4gICAgICBnbG9iYWxbY2FsbGJhY2tOYW1lXSA9IHVuZGVmaW5lZDtcbiAgICAgIHRyeSB7IGRlbGV0ZSBnbG9iYWxbY2FsbGJhY2tOYW1lXSB9IGNhdGNoIChlcnJvcikge31cbiAgICAgIHNjcmlwdC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHNjcmlwdCk7XG4gICAgfTtcblxuICAgIGdsb2JhbFtjYWxsYmFja05hbWVdID0gZnVuY3Rpb24ocmVwbGllcykge1xuICAgICAgY2xlYW51cCgpO1xuICAgICAgc2VsZi5fcmVjZWl2ZShyZXBsaWVzKTtcbiAgICB9O1xuXG4gICAgc2NyaXB0LnR5cGUgPSAndGV4dC9qYXZhc2NyaXB0JztcbiAgICBzY3JpcHQuc3JjICA9IFVSSS5zdHJpbmdpZnkoZW5kcG9pbnQpO1xuICAgIGhlYWQuYXBwZW5kQ2hpbGQoc2NyaXB0KTtcblxuICAgIHNjcmlwdC5vbmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgICBjbGVhbnVwKCk7XG4gICAgICBzZWxmLl9oYW5kbGVFcnJvcihtZXNzYWdlcyk7XG4gICAgfTtcblxuICAgIHJldHVybiB7YWJvcnQ6IGNsZWFudXB9O1xuICB9XG59KSwge1xuICBfY2JDb3VudDogMCxcblxuICBnZXRDYWxsYmFja05hbWU6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuX2NiQ291bnQgKz0gMTtcbiAgICByZXR1cm4gJ19fanNvbnAnICsgdGhpcy5fY2JDb3VudCArICdfXyc7XG4gIH0sXG5cbiAgaXNVc2FibGU6IGZ1bmN0aW9uKGRpc3BhdGNoZXIsIGVuZHBvaW50LCBjYWxsYmFjaywgY29udGV4dCkge1xuICAgIGNhbGxiYWNrLmNhbGwoY29udGV4dCwgdHJ1ZSk7XG4gIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEpTT05QO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ2xhc3MgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgQ29va2llICAgPSByZXF1aXJlKCcuLi91dGlsL2Nvb2tpZXMnKS5Db29raWUsXG4gICAgUHJvbWlzZSAgPSByZXF1aXJlKCcuLi91dGlsL3Byb21pc2UnKSxcbiAgICBVUkkgICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvdXJpJyksXG4gICAgYXJyYXkgICAgPSByZXF1aXJlKCcuLi91dGlsL2FycmF5JyksXG4gICAgZXh0ZW5kICAgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZCcpLFxuICAgIExvZ2dpbmcgID0gcmVxdWlyZSgnLi4vbWl4aW5zL2xvZ2dpbmcnKSxcbiAgICBUaW1lb3V0cyA9IHJlcXVpcmUoJy4uL21peGlucy90aW1lb3V0cycpLFxuICAgIENoYW5uZWwgID0gcmVxdWlyZSgnLi4vcHJvdG9jb2wvY2hhbm5lbCcpO1xuXG52YXIgVHJhbnNwb3J0ID0gZXh0ZW5kKENsYXNzKHsgY2xhc3NOYW1lOiAnVHJhbnNwb3J0JyxcbiAgREVGQVVMVF9QT1JUUzogeydodHRwOic6IDgwLCAnaHR0cHM6JzogNDQzLCAnd3M6JzogODAsICd3c3M6JzogNDQzfSxcbiAgTUFYX0RFTEFZOiAgICAgMCxcblxuICBiYXRjaGluZzogIHRydWUsXG5cbiAgaW5pdGlhbGl6ZTogZnVuY3Rpb24oZGlzcGF0Y2hlciwgZW5kcG9pbnQpIHtcbiAgICB0aGlzLl9kaXNwYXRjaGVyID0gZGlzcGF0Y2hlcjtcbiAgICB0aGlzLmVuZHBvaW50ICAgID0gZW5kcG9pbnQ7XG4gICAgdGhpcy5fb3V0Ym94ICAgICA9IFtdO1xuICAgIHRoaXMuX3Byb3h5ICAgICAgPSBleHRlbmQoe30sIHRoaXMuX2Rpc3BhdGNoZXIucHJveHkpO1xuXG4gICAgaWYgKCF0aGlzLl9wcm94eS5vcmlnaW4pXG4gICAgICB0aGlzLl9wcm94eS5vcmlnaW4gPSB0aGlzLl9maW5kUHJveHkoKTtcbiAgfSxcblxuICBjbG9zZTogZnVuY3Rpb24oKSB7fSxcblxuICBlbmNvZGU6IGZ1bmN0aW9uKG1lc3NhZ2VzKSB7XG4gICAgcmV0dXJuICcnO1xuICB9LFxuXG4gIHNlbmRNZXNzYWdlOiBmdW5jdGlvbihtZXNzYWdlKSB7XG4gICAgdGhpcy5kZWJ1ZygnQ2xpZW50ID8gc2VuZGluZyBtZXNzYWdlIHRvID86ID8nLFxuICAgICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hlci5jbGllbnRJZCwgVVJJLnN0cmluZ2lmeSh0aGlzLmVuZHBvaW50KSwgbWVzc2FnZSk7XG5cbiAgICBpZiAoIXRoaXMuYmF0Y2hpbmcpIHJldHVybiBQcm9taXNlLnJlc29sdmUodGhpcy5yZXF1ZXN0KFttZXNzYWdlXSkpO1xuXG4gICAgdGhpcy5fb3V0Ym94LnB1c2gobWVzc2FnZSk7XG4gICAgdGhpcy5fZmx1c2hMYXJnZUJhdGNoKCk7XG5cbiAgICBpZiAobWVzc2FnZS5jaGFubmVsID09PSBDaGFubmVsLkhBTkRTSEFLRSlcbiAgICAgIHJldHVybiB0aGlzLl9wdWJsaXNoKDAuMDEpO1xuXG4gICAgaWYgKG1lc3NhZ2UuY2hhbm5lbCA9PT0gQ2hhbm5lbC5DT05ORUNUKVxuICAgICAgdGhpcy5fY29ubmVjdE1lc3NhZ2UgPSBtZXNzYWdlO1xuXG4gICAgcmV0dXJuIHRoaXMuX3B1Ymxpc2godGhpcy5NQVhfREVMQVkpO1xuICB9LFxuXG4gIF9tYWtlUHJvbWlzZTogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuXG4gICAgdGhpcy5fcmVxdWVzdFByb21pc2UgPSB0aGlzLl9yZXF1ZXN0UHJvbWlzZSB8fCBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlKSB7XG4gICAgICBzZWxmLl9yZXNvbHZlUHJvbWlzZSA9IHJlc29sdmU7XG4gICAgfSk7XG4gIH0sXG5cbiAgX3B1Ymxpc2g6IGZ1bmN0aW9uKGRlbGF5KSB7XG4gICAgdGhpcy5fbWFrZVByb21pc2UoKTtcblxuICAgIHRoaXMuYWRkVGltZW91dCgncHVibGlzaCcsIGRlbGF5LCBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuX2ZsdXNoKCk7XG4gICAgICBkZWxldGUgdGhpcy5fcmVxdWVzdFByb21pc2U7XG4gICAgfSwgdGhpcyk7XG5cbiAgICByZXR1cm4gdGhpcy5fcmVxdWVzdFByb21pc2U7XG4gIH0sXG5cbiAgX2ZsdXNoOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnJlbW92ZVRpbWVvdXQoJ3B1Ymxpc2gnKTtcblxuICAgIGlmICh0aGlzLl9vdXRib3gubGVuZ3RoID4gMSAmJiB0aGlzLl9jb25uZWN0TWVzc2FnZSlcbiAgICAgIHRoaXMuX2Nvbm5lY3RNZXNzYWdlLmFkdmljZSA9IHt0aW1lb3V0OiAwfTtcblxuICAgIHRoaXMuX3Jlc29sdmVQcm9taXNlKHRoaXMucmVxdWVzdCh0aGlzLl9vdXRib3gpKTtcblxuICAgIHRoaXMuX2Nvbm5lY3RNZXNzYWdlID0gbnVsbDtcbiAgICB0aGlzLl9vdXRib3ggPSBbXTtcbiAgfSxcblxuICBfZmx1c2hMYXJnZUJhdGNoOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgc3RyaW5nID0gdGhpcy5lbmNvZGUodGhpcy5fb3V0Ym94KTtcbiAgICBpZiAoc3RyaW5nLmxlbmd0aCA8IHRoaXMuX2Rpc3BhdGNoZXIubWF4UmVxdWVzdFNpemUpIHJldHVybjtcbiAgICB2YXIgbGFzdCA9IHRoaXMuX291dGJveC5wb3AoKTtcblxuICAgIHRoaXMuX21ha2VQcm9taXNlKCk7XG4gICAgdGhpcy5fZmx1c2goKTtcblxuICAgIGlmIChsYXN0KSB0aGlzLl9vdXRib3gucHVzaChsYXN0KTtcbiAgfSxcblxuICBfcmVjZWl2ZTogZnVuY3Rpb24ocmVwbGllcykge1xuICAgIGlmICghcmVwbGllcykgcmV0dXJuO1xuICAgIHJlcGxpZXMgPSBbXS5jb25jYXQocmVwbGllcyk7XG5cbiAgICB0aGlzLmRlYnVnKCdDbGllbnQgPyByZWNlaXZlZCBmcm9tID8gdmlhID86ID8nLFxuICAgICAgICAgICAgICAgdGhpcy5fZGlzcGF0Y2hlci5jbGllbnRJZCwgVVJJLnN0cmluZ2lmeSh0aGlzLmVuZHBvaW50KSwgdGhpcy5jb25uZWN0aW9uVHlwZSwgcmVwbGllcyk7XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbiA9IHJlcGxpZXMubGVuZ3RoOyBpIDwgbjsgaSsrKVxuICAgICAgdGhpcy5fZGlzcGF0Y2hlci5oYW5kbGVSZXNwb25zZShyZXBsaWVzW2ldKTtcbiAgfSxcblxuICBfaGFuZGxlRXJyb3I6IGZ1bmN0aW9uKG1lc3NhZ2VzLCBpbW1lZGlhdGUpIHtcbiAgICBtZXNzYWdlcyA9IFtdLmNvbmNhdChtZXNzYWdlcyk7XG5cbiAgICB0aGlzLmRlYnVnKCdDbGllbnQgPyBmYWlsZWQgdG8gc2VuZCB0byA/IHZpYSA/OiA/JyxcbiAgICAgICAgICAgICAgIHRoaXMuX2Rpc3BhdGNoZXIuY2xpZW50SWQsIFVSSS5zdHJpbmdpZnkodGhpcy5lbmRwb2ludCksIHRoaXMuY29ubmVjdGlvblR5cGUsIG1lc3NhZ2VzKTtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbWVzc2FnZXMubGVuZ3RoOyBpIDwgbjsgaSsrKVxuICAgICAgdGhpcy5fZGlzcGF0Y2hlci5oYW5kbGVFcnJvcihtZXNzYWdlc1tpXSk7XG4gIH0sXG5cbiAgX2dldENvb2tpZXM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBjb29raWVzID0gdGhpcy5fZGlzcGF0Y2hlci5jb29raWVzLFxuICAgICAgICB1cmwgICAgID0gVVJJLnN0cmluZ2lmeSh0aGlzLmVuZHBvaW50KTtcblxuICAgIGlmICghY29va2llcykgcmV0dXJuICcnO1xuXG4gICAgcmV0dXJuIGFycmF5Lm1hcChjb29raWVzLmdldENvb2tpZXNTeW5jKHVybCksIGZ1bmN0aW9uKGNvb2tpZSkge1xuICAgICAgcmV0dXJuIGNvb2tpZS5jb29raWVTdHJpbmcoKTtcbiAgICB9KS5qb2luKCc7ICcpO1xuICB9LFxuXG4gIF9zdG9yZUNvb2tpZXM6IGZ1bmN0aW9uKHNldENvb2tpZSkge1xuICAgIHZhciBjb29raWVzID0gdGhpcy5fZGlzcGF0Y2hlci5jb29raWVzLFxuICAgICAgICB1cmwgICAgID0gVVJJLnN0cmluZ2lmeSh0aGlzLmVuZHBvaW50KSxcbiAgICAgICAgY29va2llO1xuXG4gICAgaWYgKCFzZXRDb29raWUgfHwgIWNvb2tpZXMpIHJldHVybjtcbiAgICBzZXRDb29raWUgPSBbXS5jb25jYXQoc2V0Q29va2llKTtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gc2V0Q29va2llLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgY29va2llID0gQ29va2llLnBhcnNlKHNldENvb2tpZVtpXSk7XG4gICAgICBjb29raWVzLnNldENvb2tpZVN5bmMoY29va2llLCB1cmwpO1xuICAgIH1cbiAgfSxcblxuICBfZmluZFByb3h5OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodHlwZW9mIHByb2Nlc3MgPT09ICd1bmRlZmluZWQnKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgdmFyIHByb3RvY29sID0gdGhpcy5lbmRwb2ludC5wcm90b2NvbDtcbiAgICBpZiAoIXByb3RvY29sKSByZXR1cm4gdW5kZWZpbmVkO1xuXG4gICAgdmFyIG5hbWUgICA9IHByb3RvY29sLnJlcGxhY2UoLzokLywgJycpLnRvTG93ZXJDYXNlKCkgKyAnX3Byb3h5JyxcbiAgICAgICAgdXBjYXNlID0gbmFtZS50b1VwcGVyQ2FzZSgpLFxuICAgICAgICBlbnYgICAgPSBwcm9jZXNzLmVudixcbiAgICAgICAga2V5cywgcHJveHk7XG5cbiAgICBpZiAobmFtZSA9PT0gJ2h0dHBfcHJveHknICYmIGVudi5SRVFVRVNUX01FVEhPRCkge1xuICAgICAga2V5cyA9IE9iamVjdC5rZXlzKGVudikuZmlsdGVyKGZ1bmN0aW9uKGspIHsgcmV0dXJuIC9eaHR0cF9wcm94eSQvaS50ZXN0KGspIH0pO1xuICAgICAgaWYgKGtleXMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIGlmIChrZXlzWzBdID09PSBuYW1lICYmIGVudlt1cGNhc2VdID09PSB1bmRlZmluZWQpXG4gICAgICAgICAgcHJveHkgPSBlbnZbbmFtZV07XG4gICAgICB9IGVsc2UgaWYgKGtleXMubGVuZ3RoID4gMSkge1xuICAgICAgICBwcm94eSA9IGVudltuYW1lXTtcbiAgICAgIH1cbiAgICAgIHByb3h5ID0gcHJveHkgfHwgZW52WydDR0lfJyArIHVwY2FzZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIHByb3h5ID0gZW52W25hbWVdIHx8IGVudlt1cGNhc2VdO1xuICAgICAgaWYgKHByb3h5ICYmICFlbnZbbmFtZV0pXG4gICAgICAgIGNvbnNvbGUud2FybignVGhlIGVudmlyb25tZW50IHZhcmlhYmxlICcgKyB1cGNhc2UgK1xuICAgICAgICAgICAgICAgICAgICAgJyBpcyBkaXNjb3VyYWdlZC4gVXNlICcgKyBuYW1lICsgJy4nKTtcbiAgICB9XG4gICAgcmV0dXJuIHByb3h5O1xuICB9XG5cbn0pLCB7XG4gIGdldDogZnVuY3Rpb24oZGlzcGF0Y2hlciwgYWxsb3dlZCwgZGlzYWJsZWQsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgdmFyIGVuZHBvaW50ID0gZGlzcGF0Y2hlci5lbmRwb2ludDtcblxuICAgIGFycmF5LmFzeW5jRWFjaCh0aGlzLl90cmFuc3BvcnRzLCBmdW5jdGlvbihwYWlyLCByZXN1bWUpIHtcbiAgICAgIHZhciBjb25uVHlwZSAgICAgPSBwYWlyWzBdLCBrbGFzcyA9IHBhaXJbMV0sXG4gICAgICAgICAgY29ubkVuZHBvaW50ID0gZGlzcGF0Y2hlci5lbmRwb2ludEZvcihjb25uVHlwZSk7XG5cbiAgICAgIGlmIChhcnJheS5pbmRleE9mKGRpc2FibGVkLCBjb25uVHlwZSkgPj0gMClcbiAgICAgICAgcmV0dXJuIHJlc3VtZSgpO1xuXG4gICAgICBpZiAoYXJyYXkuaW5kZXhPZihhbGxvd2VkLCBjb25uVHlwZSkgPCAwKSB7XG4gICAgICAgIGtsYXNzLmlzVXNhYmxlKGRpc3BhdGNoZXIsIGNvbm5FbmRwb2ludCwgZnVuY3Rpb24oKSB7fSk7XG4gICAgICAgIHJldHVybiByZXN1bWUoKTtcbiAgICAgIH1cblxuICAgICAga2xhc3MuaXNVc2FibGUoZGlzcGF0Y2hlciwgY29ubkVuZHBvaW50LCBmdW5jdGlvbihpc1VzYWJsZSkge1xuICAgICAgICBpZiAoIWlzVXNhYmxlKSByZXR1cm4gcmVzdW1lKCk7XG4gICAgICAgIHZhciB0cmFuc3BvcnQgPSBrbGFzcy5oYXNPd25Qcm9wZXJ0eSgnY3JlYXRlJykgPyBrbGFzcy5jcmVhdGUoZGlzcGF0Y2hlciwgY29ubkVuZHBvaW50KSA6IG5ldyBrbGFzcyhkaXNwYXRjaGVyLCBjb25uRW5kcG9pbnQpO1xuICAgICAgICBjYWxsYmFjay5jYWxsKGNvbnRleHQsIHRyYW5zcG9ydCk7XG4gICAgICB9KTtcbiAgICB9LCBmdW5jdGlvbigpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGZpbmQgYSB1c2FibGUgY29ubmVjdGlvbiB0eXBlIGZvciAnICsgVVJJLnN0cmluZ2lmeShlbmRwb2ludCkpO1xuICAgIH0pO1xuICB9LFxuXG4gIHJlZ2lzdGVyOiBmdW5jdGlvbih0eXBlLCBrbGFzcykge1xuICAgIHRoaXMuX3RyYW5zcG9ydHMucHVzaChbdHlwZSwga2xhc3NdKTtcbiAgICBrbGFzcy5wcm90b3R5cGUuY29ubmVjdGlvblR5cGUgPSB0eXBlO1xuICB9LFxuXG4gIGdldENvbm5lY3Rpb25UeXBlczogZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGFycmF5Lm1hcCh0aGlzLl90cmFuc3BvcnRzLCBmdW5jdGlvbih0KSB7IHJldHVybiB0WzBdIH0pO1xuICB9LFxuXG4gIF90cmFuc3BvcnRzOiBbXVxufSk7XG5cbmV4dGVuZChUcmFuc3BvcnQucHJvdG90eXBlLCBMb2dnaW5nKTtcbmV4dGVuZChUcmFuc3BvcnQucHJvdG90eXBlLCBUaW1lb3V0cyk7XG5cbm1vZHVsZS5leHBvcnRzID0gVHJhbnNwb3J0O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ2xhc3MgICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvY2xhc3MnKSxcbiAgICBQcm9taXNlICAgID0gcmVxdWlyZSgnLi4vdXRpbC9wcm9taXNlJyksXG4gICAgU2V0ICAgICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvc2V0JyksXG4gICAgVVJJICAgICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvdXJpJyksXG4gICAgYnJvd3NlciAgICA9IHJlcXVpcmUoJy4uL3V0aWwvYnJvd3NlcicpLFxuICAgIGNvcHlPYmplY3QgPSByZXF1aXJlKCcuLi91dGlsL2NvcHlfb2JqZWN0JyksXG4gICAgZXh0ZW5kICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvZXh0ZW5kJyksXG4gICAgdG9KU09OICAgICA9IHJlcXVpcmUoJy4uL3V0aWwvdG9fanNvbicpLFxuICAgIHdzICAgICAgICAgPSByZXF1aXJlKCcuLi91dGlsL3dlYnNvY2tldCcpLFxuICAgIERlZmVycmFibGUgPSByZXF1aXJlKCcuLi9taXhpbnMvZGVmZXJyYWJsZScpLFxuICAgIFRyYW5zcG9ydCAgPSByZXF1aXJlKCcuL3RyYW5zcG9ydCcpO1xuXG52YXIgV2ViU29ja2V0ID0gZXh0ZW5kKENsYXNzKFRyYW5zcG9ydCwge1xuICBVTkNPTk5FQ1RFRDogIDEsXG4gIENPTk5FQ1RJTkc6ICAgMixcbiAgQ09OTkVDVEVEOiAgICAzLFxuXG4gIGJhdGNoaW5nOiAgICAgZmFsc2UsXG5cbiAgaXNVc2FibGU6IGZ1bmN0aW9uKGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgdGhpcy5jYWxsYmFjayhmdW5jdGlvbigpIHsgY2FsbGJhY2suY2FsbChjb250ZXh0LCB0cnVlKSB9KTtcbiAgICB0aGlzLmVycmJhY2soZnVuY3Rpb24oKSB7IGNhbGxiYWNrLmNhbGwoY29udGV4dCwgZmFsc2UpIH0pO1xuICAgIHRoaXMuY29ubmVjdCgpO1xuICB9LFxuXG4gIHJlcXVlc3Q6IGZ1bmN0aW9uKG1lc3NhZ2VzKSB7XG4gICAgdGhpcy5fcGVuZGluZyA9IHRoaXMuX3BlbmRpbmcgfHwgbmV3IFNldCgpO1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbWVzc2FnZXMubGVuZ3RoOyBpIDwgbjsgaSsrKSB0aGlzLl9wZW5kaW5nLmFkZChtZXNzYWdlc1tpXSk7XG5cbiAgICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgICB2YXIgcHJvbWlzZSA9IG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgc2VsZi5jYWxsYmFjayhmdW5jdGlvbihzb2NrZXQpIHtcbiAgICAgICAgaWYgKCFzb2NrZXQgfHwgc29ja2V0LnJlYWR5U3RhdGUgIT09IDEpIHJldHVybjtcbiAgICAgICAgc29ja2V0LnNlbmQodG9KU09OKG1lc3NhZ2VzKSk7XG4gICAgICAgIHJlc29sdmUoc29ja2V0KTtcbiAgICAgIH0pO1xuXG4gICAgICBzZWxmLmNvbm5lY3QoKTtcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICBhYm9ydDogZnVuY3Rpb24oKSB7IHByb21pc2UudGhlbihmdW5jdGlvbih3cykgeyB3cy5jbG9zZSgpIH0pIH1cbiAgICB9O1xuICB9LFxuXG4gIGNvbm5lY3Q6IGZ1bmN0aW9uKCkge1xuICAgIGlmIChXZWJTb2NrZXQuX3VubG9hZGVkKSByZXR1cm47XG5cbiAgICB0aGlzLl9zdGF0ZSA9IHRoaXMuX3N0YXRlIHx8IHRoaXMuVU5DT05ORUNURUQ7XG4gICAgaWYgKHRoaXMuX3N0YXRlICE9PSB0aGlzLlVOQ09OTkVDVEVEKSByZXR1cm47XG4gICAgdGhpcy5fc3RhdGUgPSB0aGlzLkNPTk5FQ1RJTkc7XG5cbiAgICB2YXIgc29ja2V0ID0gdGhpcy5fY3JlYXRlU29ja2V0KCk7XG4gICAgaWYgKCFzb2NrZXQpIHJldHVybiB0aGlzLnNldERlZmVycmVkU3RhdHVzKCdmYWlsZWQnKTtcblxuICAgIHZhciBzZWxmID0gdGhpcztcblxuICAgIHNvY2tldC5vbm9wZW4gPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChzb2NrZXQuaGVhZGVycykgc2VsZi5fc3RvcmVDb29raWVzKHNvY2tldC5oZWFkZXJzWydzZXQtY29va2llJ10pO1xuICAgICAgc2VsZi5fc29ja2V0ID0gc29ja2V0O1xuICAgICAgc2VsZi5fc3RhdGUgPSBzZWxmLkNPTk5FQ1RFRDtcbiAgICAgIHNlbGYuX2V2ZXJDb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgc2VsZi5fcGluZygpO1xuICAgICAgc2VsZi5zZXREZWZlcnJlZFN0YXR1cygnc3VjY2VlZGVkJywgc29ja2V0KTtcbiAgICB9O1xuXG4gICAgdmFyIGNsb3NlZCA9IGZhbHNlO1xuICAgIHNvY2tldC5vbmNsb3NlID0gc29ja2V0Lm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChjbG9zZWQpIHJldHVybjtcbiAgICAgIGNsb3NlZCA9IHRydWU7XG5cbiAgICAgIHZhciB3YXNDb25uZWN0ZWQgPSAoc2VsZi5fc3RhdGUgPT09IHNlbGYuQ09OTkVDVEVEKTtcbiAgICAgIHNvY2tldC5vbm9wZW4gPSBzb2NrZXQub25jbG9zZSA9IHNvY2tldC5vbmVycm9yID0gc29ja2V0Lm9ubWVzc2FnZSA9IG51bGw7XG5cbiAgICAgIGRlbGV0ZSBzZWxmLl9zb2NrZXQ7XG4gICAgICBzZWxmLl9zdGF0ZSA9IHNlbGYuVU5DT05ORUNURUQ7XG4gICAgICBzZWxmLnJlbW92ZVRpbWVvdXQoJ3BpbmcnKTtcblxuICAgICAgdmFyIHBlbmRpbmcgPSBzZWxmLl9wZW5kaW5nID8gc2VsZi5fcGVuZGluZy50b0FycmF5KCkgOiBbXTtcbiAgICAgIGRlbGV0ZSBzZWxmLl9wZW5kaW5nO1xuXG4gICAgICBpZiAod2FzQ29ubmVjdGVkIHx8IHNlbGYuX2V2ZXJDb25uZWN0ZWQpIHtcbiAgICAgICAgc2VsZi5zZXREZWZlcnJlZFN0YXR1cygndW5rbm93bicpO1xuICAgICAgICBzZWxmLl9oYW5kbGVFcnJvcihwZW5kaW5nLCB3YXNDb25uZWN0ZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc2VsZi5zZXREZWZlcnJlZFN0YXR1cygnZmFpbGVkJyk7XG4gICAgICB9XG4gICAgfTtcblxuICAgIHNvY2tldC5vbm1lc3NhZ2UgPSBmdW5jdGlvbihldmVudCkge1xuICAgICAgdmFyIHJlcGxpZXM7XG4gICAgICB0cnkgeyByZXBsaWVzID0gSlNPTi5wYXJzZShldmVudC5kYXRhKSB9IGNhdGNoIChlcnJvcikge31cblxuICAgICAgaWYgKCFyZXBsaWVzKSByZXR1cm47XG5cbiAgICAgIHJlcGxpZXMgPSBbXS5jb25jYXQocmVwbGllcyk7XG5cbiAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gcmVwbGllcy5sZW5ndGg7IGkgPCBuOyBpKyspIHtcbiAgICAgICAgaWYgKHJlcGxpZXNbaV0uc3VjY2Vzc2Z1bCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgICAgc2VsZi5fcGVuZGluZy5yZW1vdmUocmVwbGllc1tpXSk7XG4gICAgICB9XG4gICAgICBzZWxmLl9yZWNlaXZlKHJlcGxpZXMpO1xuICAgIH07XG4gIH0sXG5cbiAgY2xvc2U6IGZ1bmN0aW9uKCkge1xuICAgIGlmICghdGhpcy5fc29ja2V0KSByZXR1cm47XG4gICAgdGhpcy5fc29ja2V0LmNsb3NlKCk7XG4gIH0sXG5cbiAgX2NyZWF0ZVNvY2tldDogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHVybCAgICAgICAgPSBXZWJTb2NrZXQuZ2V0U29ja2V0VXJsKHRoaXMuZW5kcG9pbnQpLFxuICAgICAgICBoZWFkZXJzICAgID0gdGhpcy5fZGlzcGF0Y2hlci5oZWFkZXJzLFxuICAgICAgICBleHRlbnNpb25zID0gdGhpcy5fZGlzcGF0Y2hlci53c0V4dGVuc2lvbnMsXG4gICAgICAgIGNvb2tpZSAgICAgPSB0aGlzLl9nZXRDb29raWVzKCksXG4gICAgICAgIHRscyAgICAgICAgPSB0aGlzLl9kaXNwYXRjaGVyLnRscyxcbiAgICAgICAgb3B0aW9ucyAgICA9IHtleHRlbnNpb25zOiBleHRlbnNpb25zLCBoZWFkZXJzOiBoZWFkZXJzLCBwcm94eTogdGhpcy5fcHJveHksIHRsczogdGxzfTtcblxuICAgIGlmIChjb29raWUgIT09ICcnKSBvcHRpb25zLmhlYWRlcnNbJ0Nvb2tpZSddID0gY29va2llO1xuXG4gICAgcmV0dXJuIHdzLmNyZWF0ZSh1cmwsIFtdLCBvcHRpb25zKTtcbiAgfSxcblxuICBfcGluZzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLl9zb2NrZXQgfHwgdGhpcy5fc29ja2V0LnJlYWR5U3RhdGUgIT09IDEpIHJldHVybjtcbiAgICB0aGlzLl9zb2NrZXQuc2VuZCgnW10nKTtcbiAgICB0aGlzLmFkZFRpbWVvdXQoJ3BpbmcnLCB0aGlzLl9kaXNwYXRjaGVyLnRpbWVvdXQgLyAyLCB0aGlzLl9waW5nLCB0aGlzKTtcbiAgfVxuXG59KSwge1xuICBQUk9UT0NPTFM6IHtcbiAgICAnaHR0cDonOiAgJ3dzOicsXG4gICAgJ2h0dHBzOic6ICd3c3M6J1xuICB9LFxuXG4gIGNyZWF0ZTogZnVuY3Rpb24oZGlzcGF0Y2hlciwgZW5kcG9pbnQpIHtcbiAgICB2YXIgc29ja2V0cyA9IGRpc3BhdGNoZXIudHJhbnNwb3J0cy53ZWJzb2NrZXQgPSBkaXNwYXRjaGVyLnRyYW5zcG9ydHMud2Vic29ja2V0IHx8IHt9O1xuICAgIHNvY2tldHNbZW5kcG9pbnQuaHJlZl0gPSBzb2NrZXRzW2VuZHBvaW50LmhyZWZdIHx8IG5ldyB0aGlzKGRpc3BhdGNoZXIsIGVuZHBvaW50KTtcbiAgICByZXR1cm4gc29ja2V0c1tlbmRwb2ludC5ocmVmXTtcbiAgfSxcblxuICBnZXRTb2NrZXRVcmw6IGZ1bmN0aW9uKGVuZHBvaW50KSB7XG4gICAgZW5kcG9pbnQgPSBjb3B5T2JqZWN0KGVuZHBvaW50KTtcbiAgICBlbmRwb2ludC5wcm90b2NvbCA9IHRoaXMuUFJPVE9DT0xTW2VuZHBvaW50LnByb3RvY29sXTtcbiAgICByZXR1cm4gVVJJLnN0cmluZ2lmeShlbmRwb2ludCk7XG4gIH0sXG5cbiAgaXNVc2FibGU6IGZ1bmN0aW9uKGRpc3BhdGNoZXIsIGVuZHBvaW50LCBjYWxsYmFjaywgY29udGV4dCkge1xuICAgIHRoaXMuY3JlYXRlKGRpc3BhdGNoZXIsIGVuZHBvaW50KS5pc1VzYWJsZShjYWxsYmFjaywgY29udGV4dCk7XG4gIH1cbn0pO1xuXG5leHRlbmQoV2ViU29ja2V0LnByb3RvdHlwZSwgRGVmZXJyYWJsZSk7XG5cbmlmIChicm93c2VyLkV2ZW50ICYmIGdsb2JhbC5vbmJlZm9yZXVubG9hZCAhPT0gdW5kZWZpbmVkKVxuICBicm93c2VyLkV2ZW50Lm9uKGdsb2JhbCwgJ2JlZm9yZXVubG9hZCcsIGZ1bmN0aW9uKCkgeyBXZWJTb2NrZXQuX3VubG9hZGVkID0gdHJ1ZSB9KTtcblxubW9kdWxlLmV4cG9ydHMgPSBXZWJTb2NrZXQ7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBDbGFzcyAgICAgPSByZXF1aXJlKCcuLi91dGlsL2NsYXNzJyksXG4gICAgVVJJICAgICAgID0gcmVxdWlyZSgnLi4vdXRpbC91cmknKSxcbiAgICBicm93c2VyICAgPSByZXF1aXJlKCcuLi91dGlsL2Jyb3dzZXInKSxcbiAgICBleHRlbmQgICAgPSByZXF1aXJlKCcuLi91dGlsL2V4dGVuZCcpLFxuICAgIHRvSlNPTiAgICA9IHJlcXVpcmUoJy4uL3V0aWwvdG9fanNvbicpLFxuICAgIFRyYW5zcG9ydCA9IHJlcXVpcmUoJy4vdHJhbnNwb3J0Jyk7XG5cbnZhciBYSFIgPSBleHRlbmQoQ2xhc3MoVHJhbnNwb3J0LCB7XG4gIGVuY29kZTogZnVuY3Rpb24obWVzc2FnZXMpIHtcbiAgICByZXR1cm4gdG9KU09OKG1lc3NhZ2VzKTtcbiAgfSxcblxuICByZXF1ZXN0OiBmdW5jdGlvbihtZXNzYWdlcykge1xuICAgIHZhciBocmVmID0gdGhpcy5lbmRwb2ludC5ocmVmLFxuICAgICAgICBzZWxmID0gdGhpcyxcbiAgICAgICAgeGhyO1xuXG4gICAgLy8gUHJlZmVyIFhNTEh0dHBSZXF1ZXN0IG92ZXIgQWN0aXZlWE9iamVjdCBpZiB0aGV5IGJvdGggZXhpc3RcbiAgICBpZiAoZ2xvYmFsLlhNTEh0dHBSZXF1ZXN0KSB7XG4gICAgICB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcbiAgICB9IGVsc2UgaWYgKGdsb2JhbC5BY3RpdmVYT2JqZWN0KSB7XG4gICAgICB4aHIgPSBuZXcgQWN0aXZlWE9iamVjdCgnTWljcm9zb2Z0LlhNTEhUVFAnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuX2hhbmRsZUVycm9yKG1lc3NhZ2VzKTtcbiAgICB9XG5cbiAgICB4aHIub3BlbignUE9TVCcsIGhyZWYsIHRydWUpO1xuICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAnYXBwbGljYXRpb24vanNvbicpO1xuICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKCdQcmFnbWEnLCAnbm8tY2FjaGUnKTtcbiAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcignWC1SZXF1ZXN0ZWQtV2l0aCcsICdYTUxIdHRwUmVxdWVzdCcpO1xuXG4gICAgdmFyIGhlYWRlcnMgPSB0aGlzLl9kaXNwYXRjaGVyLmhlYWRlcnM7XG4gICAgZm9yICh2YXIga2V5IGluIGhlYWRlcnMpIHtcbiAgICAgIGlmICghaGVhZGVycy5oYXNPd25Qcm9wZXJ0eShrZXkpKSBjb250aW51ZTtcbiAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKGtleSwgaGVhZGVyc1trZXldKTtcbiAgICB9XG5cbiAgICB2YXIgYWJvcnQgPSBmdW5jdGlvbigpIHsgeGhyLmFib3J0KCkgfTtcbiAgICBpZiAoZ2xvYmFsLm9uYmVmb3JldW5sb2FkICE9PSB1bmRlZmluZWQpXG4gICAgICBicm93c2VyLkV2ZW50Lm9uKGdsb2JhbCwgJ2JlZm9yZXVubG9hZCcsIGFib3J0KTtcblxuICAgIHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmICgheGhyIHx8IHhoci5yZWFkeVN0YXRlICE9PSA0KSByZXR1cm47XG5cbiAgICAgIHZhciByZXBsaWVzICAgID0gbnVsbCxcbiAgICAgICAgICBzdGF0dXMgICAgID0geGhyLnN0YXR1cyxcbiAgICAgICAgICB0ZXh0ICAgICAgID0geGhyLnJlc3BvbnNlVGV4dCxcbiAgICAgICAgICBzdWNjZXNzZnVsID0gKHN0YXR1cyA+PSAyMDAgJiYgc3RhdHVzIDwgMzAwKSB8fCBzdGF0dXMgPT09IDMwNCB8fCBzdGF0dXMgPT09IDEyMjM7XG5cbiAgICAgIGlmIChnbG9iYWwub25iZWZvcmV1bmxvYWQgIT09IHVuZGVmaW5lZClcbiAgICAgICAgYnJvd3Nlci5FdmVudC5kZXRhY2goZ2xvYmFsLCAnYmVmb3JldW5sb2FkJywgYWJvcnQpO1xuXG4gICAgICB4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24oKSB7fTtcbiAgICAgIHhociA9IG51bGw7XG5cbiAgICAgIGlmICghc3VjY2Vzc2Z1bCkgcmV0dXJuIHNlbGYuX2hhbmRsZUVycm9yKG1lc3NhZ2VzKTtcblxuICAgICAgdHJ5IHtcbiAgICAgICAgcmVwbGllcyA9IEpTT04ucGFyc2UodGV4dCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge31cblxuICAgICAgaWYgKHJlcGxpZXMpXG4gICAgICAgIHNlbGYuX3JlY2VpdmUocmVwbGllcyk7XG4gICAgICBlbHNlXG4gICAgICAgIHNlbGYuX2hhbmRsZUVycm9yKG1lc3NhZ2VzKTtcbiAgICB9O1xuXG4gICAgeGhyLnNlbmQodGhpcy5lbmNvZGUobWVzc2FnZXMpKTtcbiAgICByZXR1cm4geGhyO1xuICB9XG59KSwge1xuICBpc1VzYWJsZTogZnVuY3Rpb24oZGlzcGF0Y2hlciwgZW5kcG9pbnQsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgdmFyIHVzYWJsZSA9IChuYXZpZ2F0b3IucHJvZHVjdCA9PT0gJ1JlYWN0TmF0aXZlJylcbiAgICAgICAgICAgICAgfHwgVVJJLmlzU2FtZU9yaWdpbihlbmRwb2ludCk7XG5cbiAgICBjYWxsYmFjay5jYWxsKGNvbnRleHQsIHVzYWJsZSk7XG4gIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFhIUjtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGNvbW1vbkVsZW1lbnQ6IGZ1bmN0aW9uKGxpc3RhLCBsaXN0Yikge1xuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlzdGEubGVuZ3RoOyBpIDwgbjsgaSsrKSB7XG4gICAgICBpZiAodGhpcy5pbmRleE9mKGxpc3RiLCBsaXN0YVtpXSkgIT09IC0xKVxuICAgICAgICByZXR1cm4gbGlzdGFbaV07XG4gICAgfVxuICAgIHJldHVybiBudWxsO1xuICB9LFxuXG4gIGluZGV4T2Y6IGZ1bmN0aW9uKGxpc3QsIG5lZWRsZSkge1xuICAgIGlmIChsaXN0LmluZGV4T2YpIHJldHVybiBsaXN0LmluZGV4T2YobmVlZGxlKTtcblxuICAgIGZvciAodmFyIGkgPSAwLCBuID0gbGlzdC5sZW5ndGg7IGkgPCBuOyBpKyspIHtcbiAgICAgIGlmIChsaXN0W2ldID09PSBuZWVkbGUpIHJldHVybiBpO1xuICAgIH1cbiAgICByZXR1cm4gLTE7XG4gIH0sXG5cbiAgbWFwOiBmdW5jdGlvbihvYmplY3QsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgaWYgKG9iamVjdC5tYXApIHJldHVybiBvYmplY3QubWFwKGNhbGxiYWNrLCBjb250ZXh0KTtcbiAgICB2YXIgcmVzdWx0ID0gW107XG5cbiAgICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gb2JqZWN0Lmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgICByZXN1bHQucHVzaChjYWxsYmFjay5jYWxsKGNvbnRleHQgfHwgbnVsbCwgb2JqZWN0W2ldLCBpKSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAodmFyIGtleSBpbiBvYmplY3QpIHtcbiAgICAgICAgaWYgKCFvYmplY3QuaGFzT3duUHJvcGVydHkoa2V5KSkgY29udGludWU7XG4gICAgICAgIHJlc3VsdC5wdXNoKGNhbGxiYWNrLmNhbGwoY29udGV4dCB8fCBudWxsLCBrZXksIG9iamVjdFtrZXldKSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cbiAgZmlsdGVyOiBmdW5jdGlvbihhcnJheSwgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICBpZiAoYXJyYXkuZmlsdGVyKSByZXR1cm4gYXJyYXkuZmlsdGVyKGNhbGxiYWNrLCBjb250ZXh0KTtcbiAgICB2YXIgcmVzdWx0ID0gW107XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBhcnJheS5sZW5ndGg7IGkgPCBuOyBpKyspIHtcbiAgICAgIGlmIChjYWxsYmFjay5jYWxsKGNvbnRleHQgfHwgbnVsbCwgYXJyYXlbaV0sIGkpKVxuICAgICAgICByZXN1bHQucHVzaChhcnJheVtpXSk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cbiAgYXN5bmNFYWNoOiBmdW5jdGlvbihsaXN0LCBpdGVyYXRvciwgY2FsbGJhY2ssIGNvbnRleHQpIHtcbiAgICB2YXIgbiAgICAgICA9IGxpc3QubGVuZ3RoLFxuICAgICAgICBpICAgICAgID0gLTEsXG4gICAgICAgIGNhbGxzICAgPSAwLFxuICAgICAgICBsb29waW5nID0gZmFsc2U7XG5cbiAgICB2YXIgaXRlcmF0ZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgY2FsbHMgLT0gMTtcbiAgICAgIGkgKz0gMTtcbiAgICAgIGlmIChpID09PSBuKSByZXR1cm4gY2FsbGJhY2sgJiYgY2FsbGJhY2suY2FsbChjb250ZXh0KTtcbiAgICAgIGl0ZXJhdG9yKGxpc3RbaV0sIHJlc3VtZSk7XG4gICAgfTtcblxuICAgIHZhciBsb29wID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAobG9vcGluZykgcmV0dXJuO1xuICAgICAgbG9vcGluZyA9IHRydWU7XG4gICAgICB3aGlsZSAoY2FsbHMgPiAwKSBpdGVyYXRlKCk7XG4gICAgICBsb29waW5nID0gZmFsc2U7XG4gICAgfTtcblxuICAgIHZhciByZXN1bWUgPSBmdW5jdGlvbigpIHtcbiAgICAgIGNhbGxzICs9IDE7XG4gICAgICBsb29wKCk7XG4gICAgfTtcbiAgICByZXN1bWUoKTtcbiAgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIEV2ZW50ID0ge1xuICBfcmVnaXN0cnk6IFtdLFxuXG4gIG9uOiBmdW5jdGlvbihlbGVtZW50LCBldmVudE5hbWUsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgdmFyIHdyYXBwZWQgPSBmdW5jdGlvbigpIHsgY2FsbGJhY2suY2FsbChjb250ZXh0KSB9O1xuXG4gICAgaWYgKGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcilcbiAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIHdyYXBwZWQsIGZhbHNlKTtcbiAgICBlbHNlXG4gICAgICBlbGVtZW50LmF0dGFjaEV2ZW50KCdvbicgKyBldmVudE5hbWUsIHdyYXBwZWQpO1xuXG4gICAgdGhpcy5fcmVnaXN0cnkucHVzaCh7XG4gICAgICBfZWxlbWVudDogICBlbGVtZW50LFxuICAgICAgX3R5cGU6ICAgICAgZXZlbnROYW1lLFxuICAgICAgX2NhbGxiYWNrOiAgY2FsbGJhY2ssXG4gICAgICBfY29udGV4dDogICAgIGNvbnRleHQsXG4gICAgICBfaGFuZGxlcjogICB3cmFwcGVkXG4gICAgfSk7XG4gIH0sXG5cbiAgZGV0YWNoOiBmdW5jdGlvbihlbGVtZW50LCBldmVudE5hbWUsIGNhbGxiYWNrLCBjb250ZXh0KSB7XG4gICAgdmFyIGkgPSB0aGlzLl9yZWdpc3RyeS5sZW5ndGgsIHJlZ2lzdGVyO1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgIHJlZ2lzdGVyID0gdGhpcy5fcmVnaXN0cnlbaV07XG5cbiAgICAgIGlmICgoZWxlbWVudCAgICAmJiBlbGVtZW50ICAgICE9PSByZWdpc3Rlci5fZWxlbWVudCkgIHx8XG4gICAgICAgICAgKGV2ZW50TmFtZSAgJiYgZXZlbnROYW1lICAhPT0gcmVnaXN0ZXIuX3R5cGUpICAgICB8fFxuICAgICAgICAgIChjYWxsYmFjayAgICYmIGNhbGxiYWNrICAgIT09IHJlZ2lzdGVyLl9jYWxsYmFjaykgfHxcbiAgICAgICAgICAoY29udGV4dCAgICAmJiBjb250ZXh0ICAgICE9PSByZWdpc3Rlci5fY29udGV4dCkpXG4gICAgICAgIGNvbnRpbnVlO1xuXG4gICAgICBpZiAocmVnaXN0ZXIuX2VsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcilcbiAgICAgICAgcmVnaXN0ZXIuX2VsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihyZWdpc3Rlci5fdHlwZSwgcmVnaXN0ZXIuX2hhbmRsZXIsIGZhbHNlKTtcbiAgICAgIGVsc2VcbiAgICAgICAgcmVnaXN0ZXIuX2VsZW1lbnQuZGV0YWNoRXZlbnQoJ29uJyArIHJlZ2lzdGVyLl90eXBlLCByZWdpc3Rlci5faGFuZGxlcik7XG5cbiAgICAgIHRoaXMuX3JlZ2lzdHJ5LnNwbGljZShpLDEpO1xuICAgICAgcmVnaXN0ZXIgPSBudWxsO1xuICAgIH1cbiAgfVxufTtcblxuaWYgKGdsb2JhbC5vbnVubG9hZCAhPT0gdW5kZWZpbmVkKVxuICBFdmVudC5vbihnbG9iYWwsICd1bmxvYWQnLCBFdmVudC5kZXRhY2gsIEV2ZW50KTtcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIEV2ZW50OiBFdmVudFxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vZXh0ZW5kJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24ocGFyZW50LCBtZXRob2RzKSB7XG4gIGlmICh0eXBlb2YgcGFyZW50ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgbWV0aG9kcyA9IHBhcmVudDtcbiAgICBwYXJlbnQgID0gT2JqZWN0O1xuICB9XG5cbiAgdmFyIGtsYXNzID0gZnVuY3Rpb24oKSB7XG4gICAgaWYgKCF0aGlzLmluaXRpYWxpemUpIHJldHVybiB0aGlzO1xuICAgIHJldHVybiB0aGlzLmluaXRpYWxpemUuYXBwbHkodGhpcywgYXJndW1lbnRzKSB8fCB0aGlzO1xuICB9O1xuXG4gIHZhciBicmlkZ2UgPSBmdW5jdGlvbigpIHt9O1xuICBicmlkZ2UucHJvdG90eXBlID0gcGFyZW50LnByb3RvdHlwZTtcblxuICBrbGFzcy5wcm90b3R5cGUgPSBuZXcgYnJpZGdlKCk7XG4gIGV4dGVuZChrbGFzcy5wcm90b3R5cGUsIG1ldGhvZHMpO1xuXG4gIHJldHVybiBrbGFzcztcbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgVkVSU0lPTjogICAgICAgICAgJzEuMi40JyxcblxuICBCQVlFVVhfVkVSU0lPTjogICAnMS4wJyxcbiAgSURfTEVOR1RIOiAgICAgICAgMTYwLFxuICBKU09OUF9DQUxMQkFDSzogICAnanNvbnBjYWxsYmFjaycsXG4gIENPTk5FQ1RJT05fVFlQRVM6IFsnbG9uZy1wb2xsaW5nJywgJ2Nyb3NzLW9yaWdpbi1sb25nLXBvbGxpbmcnLCAnY2FsbGJhY2stcG9sbGluZycsICd3ZWJzb2NrZXQnLCAnZXZlbnRzb3VyY2UnLCAnaW4tcHJvY2VzcyddLFxuXG4gIE1BTkRBVE9SWV9DT05ORUNUSU9OX1RZUEVTOiBbJ2xvbmctcG9sbGluZycsICdjYWxsYmFjay1wb2xsaW5nJywgJ2luLXByb2Nlc3MnXVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB7fTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNvcHlPYmplY3QgPSBmdW5jdGlvbihvYmplY3QpIHtcbiAgdmFyIGNsb25lLCBpLCBrZXk7XG4gIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIGNsb25lID0gW107XG4gICAgaSA9IG9iamVjdC5sZW5ndGg7XG4gICAgd2hpbGUgKGktLSkgY2xvbmVbaV0gPSBjb3B5T2JqZWN0KG9iamVjdFtpXSk7XG4gICAgcmV0dXJuIGNsb25lO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBvYmplY3QgPT09ICdvYmplY3QnKSB7XG4gICAgY2xvbmUgPSAob2JqZWN0ID09PSBudWxsKSA/IG51bGwgOiB7fTtcbiAgICBmb3IgKGtleSBpbiBvYmplY3QpIGNsb25lW2tleV0gPSBjb3B5T2JqZWN0KG9iamVjdFtrZXldKTtcbiAgICByZXR1cm4gY2xvbmU7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBjb3B5T2JqZWN0O1xuIiwiLypcbkNvcHlyaWdodCBKb3llbnQsIEluYy4gYW5kIG90aGVyIE5vZGUgY29udHJpYnV0b3JzLiBBbGwgcmlnaHRzIHJlc2VydmVkLlxuUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weSBvZlxudGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpblxudGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0b1xudXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXNcbm9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkb1xuc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuXG5UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpbiBhbGxcbmNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG5cblRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbklNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG5BVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG5MSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEVcblNPRlRXQVJFLlxuKi9cblxudmFyIGlzQXJyYXkgPSB0eXBlb2YgQXJyYXkuaXNBcnJheSA9PT0gJ2Z1bmN0aW9uJ1xuICAgID8gQXJyYXkuaXNBcnJheVxuICAgIDogZnVuY3Rpb24gKHhzKSB7XG4gICAgICAgIHJldHVybiBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoeHMpID09PSAnW29iamVjdCBBcnJheV0nXG4gICAgfVxuO1xuZnVuY3Rpb24gaW5kZXhPZiAoeHMsIHgpIHtcbiAgICBpZiAoeHMuaW5kZXhPZikgcmV0dXJuIHhzLmluZGV4T2YoeCk7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoeCA9PT0geHNbaV0pIHJldHVybiBpO1xuICAgIH1cbiAgICByZXR1cm4gLTE7XG59XG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHt9XG5tb2R1bGUuZXhwb3J0cyA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24odHlwZSkge1xuICAvLyBJZiB0aGVyZSBpcyBubyAnZXJyb3InIGV2ZW50IGxpc3RlbmVyIHRoZW4gdGhyb3cuXG4gIGlmICh0eXBlID09PSAnZXJyb3InKSB7XG4gICAgaWYgKCF0aGlzLl9ldmVudHMgfHwgIXRoaXMuX2V2ZW50cy5lcnJvciB8fFxuICAgICAgICAoaXNBcnJheSh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSlcbiAgICB7XG4gICAgICBpZiAoYXJndW1lbnRzWzFdIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgICAgdGhyb3cgYXJndW1lbnRzWzFdOyAvLyBVbmhhbmRsZWQgJ2Vycm9yJyBldmVudFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5jYXVnaHQsIHVuc3BlY2lmaWVkICdlcnJvcicgZXZlbnQuXCIpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIGlmICghdGhpcy5fZXZlbnRzKSByZXR1cm4gZmFsc2U7XG4gIHZhciBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuICBpZiAoIWhhbmRsZXIpIHJldHVybiBmYWxzZTtcblxuICBpZiAodHlwZW9mIGhhbmRsZXIgPT0gJ2Z1bmN0aW9uJykge1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgLy8gZmFzdCBjYXNlc1xuICAgICAgY2FzZSAxOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcyk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAyOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdKTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM6XG4gICAgICAgIGhhbmRsZXIuY2FsbCh0aGlzLCBhcmd1bWVudHNbMV0sIGFyZ3VtZW50c1syXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgLy8gc2xvd2VyXG4gICAgICBkZWZhdWx0OlxuICAgICAgICB2YXIgYXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgICAgIGhhbmRsZXIuYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSBpZiAoaXNBcnJheShoYW5kbGVyKSkge1xuICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcblxuICAgIHZhciBsaXN0ZW5lcnMgPSBoYW5kbGVyLnNsaWNlKCk7XG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBsaXN0ZW5lcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICBsaXN0ZW5lcnNbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG4vLyBFdmVudEVtaXR0ZXIgaXMgZGVmaW5lZCBpbiBzcmMvbm9kZV9ldmVudHMuY2Ncbi8vIEV2ZW50RW1pdHRlci5wcm90b3R5cGUuZW1pdCgpIGlzIGFsc28gZGVmaW5lZCB0aGVyZS5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXIgPSBmdW5jdGlvbih0eXBlLCBsaXN0ZW5lcikge1xuICBpZiAoJ2Z1bmN0aW9uJyAhPT0gdHlwZW9mIGxpc3RlbmVyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdhZGRMaXN0ZW5lciBvbmx5IHRha2VzIGluc3RhbmNlcyBvZiBGdW5jdGlvbicpO1xuICB9XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpIHRoaXMuX2V2ZW50cyA9IHt9O1xuXG4gIC8vIFRvIGF2b2lkIHJlY3Vyc2lvbiBpbiB0aGUgY2FzZSB0aGF0IHR5cGUgPT0gXCJuZXdMaXN0ZW5lcnNcIiEgQmVmb3JlXG4gIC8vIGFkZGluZyBpdCB0byB0aGUgbGlzdGVuZXJzLCBmaXJzdCBlbWl0IFwibmV3TGlzdGVuZXJzXCIuXG4gIHRoaXMuZW1pdCgnbmV3TGlzdGVuZXInLCB0eXBlLCBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pIHtcbiAgICAvLyBPcHRpbWl6ZSB0aGUgY2FzZSBvZiBvbmUgbGlzdGVuZXIuIERvbid0IG5lZWQgdGhlIGV4dHJhIGFycmF5IG9iamVjdC5cbiAgICB0aGlzLl9ldmVudHNbdHlwZV0gPSBsaXN0ZW5lcjtcbiAgfSBlbHNlIGlmIChpc0FycmF5KHRoaXMuX2V2ZW50c1t0eXBlXSkpIHtcbiAgICAvLyBJZiB3ZSd2ZSBhbHJlYWR5IGdvdCBhbiBhcnJheSwganVzdCBhcHBlbmQuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdLnB1c2gobGlzdGVuZXIpO1xuICB9IGVsc2Uge1xuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgc2VsZi5vbih0eXBlLCBmdW5jdGlvbiBnKCkge1xuICAgIHNlbGYucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG4gICAgbGlzdGVuZXIuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfSk7XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgaWYgKCdmdW5jdGlvbicgIT09IHR5cGVvZiBsaXN0ZW5lcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncmVtb3ZlTGlzdGVuZXIgb25seSB0YWtlcyBpbnN0YW5jZXMgb2YgRnVuY3Rpb24nKTtcbiAgfVxuXG4gIC8vIGRvZXMgbm90IHVzZSBsaXN0ZW5lcnMoKSwgc28gbm8gc2lkZSBlZmZlY3Qgb2YgY3JlYXRpbmcgX2V2ZW50c1t0eXBlXVxuICBpZiAoIXRoaXMuX2V2ZW50cyB8fCAhdGhpcy5fZXZlbnRzW3R5cGVdKSByZXR1cm4gdGhpcztcblxuICB2YXIgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcblxuICBpZiAoaXNBcnJheShsaXN0KSkge1xuICAgIHZhciBpID0gaW5kZXhPZihsaXN0LCBsaXN0ZW5lcik7XG4gICAgaWYgKGkgPCAwKSByZXR1cm4gdGhpcztcbiAgICBsaXN0LnNwbGljZShpLCAxKTtcbiAgICBpZiAobGlzdC5sZW5ndGggPT0gMClcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIH0gZWxzZSBpZiAodGhpcy5fZXZlbnRzW3R5cGVdID09PSBsaXN0ZW5lcikge1xuICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID0gZnVuY3Rpb24odHlwZSkge1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZG9lcyBub3QgdXNlIGxpc3RlbmVycygpLCBzbyBubyBzaWRlIGVmZmVjdCBvZiBjcmVhdGluZyBfZXZlbnRzW3R5cGVdXG4gIGlmICh0eXBlICYmIHRoaXMuX2V2ZW50cyAmJiB0aGlzLl9ldmVudHNbdHlwZV0pIHRoaXMuX2V2ZW50c1t0eXBlXSA9IG51bGw7XG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIGlmICghdGhpcy5fZXZlbnRzKSB0aGlzLl9ldmVudHMgPSB7fTtcbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFtdO1xuICBpZiAoIWlzQXJyYXkodGhpcy5fZXZlbnRzW3R5cGVdKSkge1xuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV1dO1xuICB9XG4gIHJldHVybiB0aGlzLl9ldmVudHNbdHlwZV07XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKGRlc3QsIHNvdXJjZSwgb3ZlcndyaXRlKSB7XG4gIGlmICghc291cmNlKSByZXR1cm4gZGVzdDtcbiAgZm9yICh2YXIga2V5IGluIHNvdXJjZSkge1xuICAgIGlmICghc291cmNlLmhhc093blByb3BlcnR5KGtleSkpIGNvbnRpbnVlO1xuICAgIGlmIChkZXN0Lmhhc093blByb3BlcnR5KGtleSkgJiYgb3ZlcndyaXRlID09PSBmYWxzZSkgY29udGludWU7XG4gICAgaWYgKGRlc3Rba2V5XSAhPT0gc291cmNlW2tleV0pXG4gICAgICBkZXN0W2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgfVxuICByZXR1cm4gZGVzdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhc2FwID0gcmVxdWlyZSgnYXNhcCcpO1xuXG52YXIgUEVORElORyAgID0gMCxcbiAgICBGVUxGSUxMRUQgPSAxLFxuICAgIFJFSkVDVEVEICA9IDI7XG5cbnZhciBSRVRVUk4gPSBmdW5jdGlvbih4KSB7IHJldHVybiB4IH0sXG4gICAgVEhST1cgID0gZnVuY3Rpb24oeCkgeyB0aHJvdyAgeCB9O1xuXG52YXIgUHJvbWlzZSA9IGZ1bmN0aW9uKHRhc2spIHtcbiAgdGhpcy5fc3RhdGUgICAgICAgPSBQRU5ESU5HO1xuICB0aGlzLl9vbkZ1bGZpbGxlZCA9IFtdO1xuICB0aGlzLl9vblJlamVjdGVkICA9IFtdO1xuXG4gIGlmICh0eXBlb2YgdGFzayAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuO1xuICB2YXIgc2VsZiA9IHRoaXM7XG5cbiAgdGFzayhmdW5jdGlvbih2YWx1ZSkgIHsgcmVzb2x2ZShzZWxmLCB2YWx1ZSkgfSxcbiAgICAgICBmdW5jdGlvbihyZWFzb24pIHsgcmVqZWN0KHNlbGYsIHJlYXNvbikgfSk7XG59O1xuXG5Qcm9taXNlLnByb3RvdHlwZS50aGVuID0gZnVuY3Rpb24ob25GdWxmaWxsZWQsIG9uUmVqZWN0ZWQpIHtcbiAgdmFyIG5leHQgPSBuZXcgUHJvbWlzZSgpO1xuICByZWdpc3Rlck9uRnVsZmlsbGVkKHRoaXMsIG9uRnVsZmlsbGVkLCBuZXh0KTtcbiAgcmVnaXN0ZXJPblJlamVjdGVkKHRoaXMsIG9uUmVqZWN0ZWQsIG5leHQpO1xuICByZXR1cm4gbmV4dDtcbn07XG5cblByb21pc2UucHJvdG90eXBlWydjYXRjaCddID0gZnVuY3Rpb24ob25SZWplY3RlZCkge1xuICByZXR1cm4gdGhpcy50aGVuKG51bGwsIG9uUmVqZWN0ZWQpO1xufTtcblxudmFyIHJlZ2lzdGVyT25GdWxmaWxsZWQgPSBmdW5jdGlvbihwcm9taXNlLCBvbkZ1bGZpbGxlZCwgbmV4dCkge1xuICBpZiAodHlwZW9mIG9uRnVsZmlsbGVkICE9PSAnZnVuY3Rpb24nKSBvbkZ1bGZpbGxlZCA9IFJFVFVSTjtcbiAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbih2YWx1ZSkgeyBpbnZva2Uob25GdWxmaWxsZWQsIHZhbHVlLCBuZXh0KSB9O1xuXG4gIGlmIChwcm9taXNlLl9zdGF0ZSA9PT0gUEVORElORykge1xuICAgIHByb21pc2UuX29uRnVsZmlsbGVkLnB1c2goaGFuZGxlcik7XG4gIH0gZWxzZSBpZiAocHJvbWlzZS5fc3RhdGUgPT09IEZVTEZJTExFRCkge1xuICAgIGhhbmRsZXIocHJvbWlzZS5fdmFsdWUpO1xuICB9XG59O1xuXG52YXIgcmVnaXN0ZXJPblJlamVjdGVkID0gZnVuY3Rpb24ocHJvbWlzZSwgb25SZWplY3RlZCwgbmV4dCkge1xuICBpZiAodHlwZW9mIG9uUmVqZWN0ZWQgIT09ICdmdW5jdGlvbicpIG9uUmVqZWN0ZWQgPSBUSFJPVztcbiAgdmFyIGhhbmRsZXIgPSBmdW5jdGlvbihyZWFzb24pIHsgaW52b2tlKG9uUmVqZWN0ZWQsIHJlYXNvbiwgbmV4dCkgfTtcblxuICBpZiAocHJvbWlzZS5fc3RhdGUgPT09IFBFTkRJTkcpIHtcbiAgICBwcm9taXNlLl9vblJlamVjdGVkLnB1c2goaGFuZGxlcik7XG4gIH0gZWxzZSBpZiAocHJvbWlzZS5fc3RhdGUgPT09IFJFSkVDVEVEKSB7XG4gICAgaGFuZGxlcihwcm9taXNlLl9yZWFzb24pO1xuICB9XG59O1xuXG52YXIgaW52b2tlID0gZnVuY3Rpb24oZm4sIHZhbHVlLCBuZXh0KSB7XG4gIGFzYXAoZnVuY3Rpb24oKSB7IF9pbnZva2UoZm4sIHZhbHVlLCBuZXh0KSB9KTtcbn07XG5cbnZhciBfaW52b2tlID0gZnVuY3Rpb24oZm4sIHZhbHVlLCBuZXh0KSB7XG4gIHZhciBvdXRjb21lO1xuXG4gIHRyeSB7XG4gICAgb3V0Y29tZSA9IGZuKHZhbHVlKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4gcmVqZWN0KG5leHQsIGVycm9yKTtcbiAgfVxuXG4gIGlmIChvdXRjb21lID09PSBuZXh0KSB7XG4gICAgcmVqZWN0KG5leHQsIG5ldyBUeXBlRXJyb3IoJ1JlY3Vyc2l2ZSBwcm9taXNlIGNoYWluIGRldGVjdGVkJykpO1xuICB9IGVsc2Uge1xuICAgIHJlc29sdmUobmV4dCwgb3V0Y29tZSk7XG4gIH1cbn07XG5cbnZhciByZXNvbHZlID0gZnVuY3Rpb24ocHJvbWlzZSwgdmFsdWUpIHtcbiAgdmFyIGNhbGxlZCA9IGZhbHNlLCB0eXBlLCB0aGVuO1xuXG4gIHRyeSB7XG4gICAgdHlwZSA9IHR5cGVvZiB2YWx1ZTtcbiAgICB0aGVuID0gdmFsdWUgIT09IG51bGwgJiYgKHR5cGUgPT09ICdmdW5jdGlvbicgfHwgdHlwZSA9PT0gJ29iamVjdCcpICYmIHZhbHVlLnRoZW47XG5cbiAgICBpZiAodHlwZW9mIHRoZW4gIT09ICdmdW5jdGlvbicpIHJldHVybiBmdWxmaWxsKHByb21pc2UsIHZhbHVlKTtcblxuICAgIHRoZW4uY2FsbCh2YWx1ZSwgZnVuY3Rpb24odikge1xuICAgICAgaWYgKCEoY2FsbGVkIF4gKGNhbGxlZCA9IHRydWUpKSkgcmV0dXJuO1xuICAgICAgcmVzb2x2ZShwcm9taXNlLCB2KTtcbiAgICB9LCBmdW5jdGlvbihyKSB7XG4gICAgICBpZiAoIShjYWxsZWQgXiAoY2FsbGVkID0gdHJ1ZSkpKSByZXR1cm47XG4gICAgICByZWplY3QocHJvbWlzZSwgcik7XG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKCEoY2FsbGVkIF4gKGNhbGxlZCA9IHRydWUpKSkgcmV0dXJuO1xuICAgIHJlamVjdChwcm9taXNlLCBlcnJvcik7XG4gIH1cbn07XG5cbnZhciBmdWxmaWxsID0gZnVuY3Rpb24ocHJvbWlzZSwgdmFsdWUpIHtcbiAgaWYgKHByb21pc2UuX3N0YXRlICE9PSBQRU5ESU5HKSByZXR1cm47XG5cbiAgcHJvbWlzZS5fc3RhdGUgICAgICA9IEZVTEZJTExFRDtcbiAgcHJvbWlzZS5fdmFsdWUgICAgICA9IHZhbHVlO1xuICBwcm9taXNlLl9vblJlamVjdGVkID0gW107XG5cbiAgdmFyIG9uRnVsZmlsbGVkID0gcHJvbWlzZS5fb25GdWxmaWxsZWQsIGZuO1xuICB3aGlsZSAoZm4gPSBvbkZ1bGZpbGxlZC5zaGlmdCgpKSBmbih2YWx1ZSk7XG59O1xuXG52YXIgcmVqZWN0ID0gZnVuY3Rpb24ocHJvbWlzZSwgcmVhc29uKSB7XG4gIGlmIChwcm9taXNlLl9zdGF0ZSAhPT0gUEVORElORykgcmV0dXJuO1xuXG4gIHByb21pc2UuX3N0YXRlICAgICAgID0gUkVKRUNURUQ7XG4gIHByb21pc2UuX3JlYXNvbiAgICAgID0gcmVhc29uO1xuICBwcm9taXNlLl9vbkZ1bGZpbGxlZCA9IFtdO1xuXG4gIHZhciBvblJlamVjdGVkID0gcHJvbWlzZS5fb25SZWplY3RlZCwgZm47XG4gIHdoaWxlIChmbiA9IG9uUmVqZWN0ZWQuc2hpZnQoKSkgZm4ocmVhc29uKTtcbn07XG5cblByb21pc2UucmVzb2x2ZSA9IGZ1bmN0aW9uKHZhbHVlKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHsgcmVzb2x2ZSh2YWx1ZSkgfSk7XG59O1xuXG5Qcm9taXNlLnJlamVjdCA9IGZ1bmN0aW9uKHJlYXNvbikge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7IHJlamVjdChyZWFzb24pIH0pO1xufTtcblxuUHJvbWlzZS5hbGwgPSBmdW5jdGlvbihwcm9taXNlcykge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgdmFyIGxpc3QgPSBbXSwgbiA9IHByb21pc2VzLmxlbmd0aCwgaTtcblxuICAgIGlmIChuID09PSAwKSByZXR1cm4gcmVzb2x2ZShsaXN0KTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBuOyBpKyspIChmdW5jdGlvbihwcm9taXNlLCBpKSB7XG4gICAgICBQcm9taXNlLnJlc29sdmUocHJvbWlzZSkudGhlbihmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICBsaXN0W2ldID0gdmFsdWU7XG4gICAgICAgIGlmICgtLW4gPT09IDApIHJlc29sdmUobGlzdCk7XG4gICAgICB9LCByZWplY3QpO1xuICAgIH0pKHByb21pc2VzW2ldLCBpKTtcbiAgfSk7XG59O1xuXG5Qcm9taXNlLnJhY2UgPSBmdW5jdGlvbihwcm9taXNlcykge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgZm9yICh2YXIgaSA9IDAsIG4gPSBwcm9taXNlcy5sZW5ndGg7IGkgPCBuOyBpKyspXG4gICAgICBQcm9taXNlLnJlc29sdmUocHJvbWlzZXNbaV0pLnRoZW4ocmVzb2x2ZSwgcmVqZWN0KTtcbiAgfSk7XG59O1xuXG5Qcm9taXNlLmRlZmVycmVkID0gUHJvbWlzZS5wZW5kaW5nID0gZnVuY3Rpb24oKSB7XG4gIHZhciB0dXBsZSA9IHt9O1xuXG4gIHR1cGxlLnByb21pc2UgPSBuZXcgUHJvbWlzZShmdW5jdGlvbihyZXNvbHZlLCByZWplY3QpIHtcbiAgICB0dXBsZS5yZXNvbHZlID0gcmVzb2x2ZTtcbiAgICB0dXBsZS5yZWplY3QgID0gcmVqZWN0O1xuICB9KTtcbiAgcmV0dXJuIHR1cGxlO1xufTtcblxubW9kdWxlLmV4cG9ydHMgPSBQcm9taXNlO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ2xhc3MgPSByZXF1aXJlKCcuL2NsYXNzJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ2xhc3Moe1xuICBpbml0aWFsaXplOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLl9pbmRleCA9IHt9O1xuICB9LFxuXG4gIGFkZDogZnVuY3Rpb24oaXRlbSkge1xuICAgIHZhciBrZXkgPSAoaXRlbS5pZCAhPT0gdW5kZWZpbmVkKSA/IGl0ZW0uaWQgOiBpdGVtO1xuICAgIGlmICh0aGlzLl9pbmRleC5oYXNPd25Qcm9wZXJ0eShrZXkpKSByZXR1cm4gZmFsc2U7XG4gICAgdGhpcy5faW5kZXhba2V5XSA9IGl0ZW07XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgZm9yRWFjaDogZnVuY3Rpb24oYmxvY2ssIGNvbnRleHQpIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gdGhpcy5faW5kZXgpIHtcbiAgICAgIGlmICh0aGlzLl9pbmRleC5oYXNPd25Qcm9wZXJ0eShrZXkpKVxuICAgICAgICBibG9jay5jYWxsKGNvbnRleHQsIHRoaXMuX2luZGV4W2tleV0pO1xuICAgIH1cbiAgfSxcblxuICBpc0VtcHR5OiBmdW5jdGlvbigpIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gdGhpcy5faW5kZXgpIHtcbiAgICAgIGlmICh0aGlzLl9pbmRleC5oYXNPd25Qcm9wZXJ0eShrZXkpKSByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIG1lbWJlcjogZnVuY3Rpb24oaXRlbSkge1xuICAgIGZvciAodmFyIGtleSBpbiB0aGlzLl9pbmRleCkge1xuICAgICAgaWYgKHRoaXMuX2luZGV4W2tleV0gPT09IGl0ZW0pIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH0sXG5cbiAgcmVtb3ZlOiBmdW5jdGlvbihpdGVtKSB7XG4gICAgdmFyIGtleSA9IChpdGVtLmlkICE9PSB1bmRlZmluZWQpID8gaXRlbS5pZCA6IGl0ZW07XG4gICAgdmFyIHJlbW92ZWQgPSB0aGlzLl9pbmRleFtrZXldO1xuICAgIGRlbGV0ZSB0aGlzLl9pbmRleFtrZXldO1xuICAgIHJldHVybiByZW1vdmVkO1xuICB9LFxuXG4gIHRvQXJyYXk6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBhcnJheSA9IFtdO1xuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbihpdGVtKSB7IGFycmF5LnB1c2goaXRlbSkgfSk7XG4gICAgcmV0dXJuIGFycmF5O1xuICB9XG59KTtcbiIsIid1c2Ugc3RyaWN0JztcblxuLy8gaHR0cDovL2Fzc2Fua2EubmV0L2NvbnRlbnQvdGVjaC8yMDA5LzA5LzAyL2pzb24yLWpzLXZzLXByb3RvdHlwZS9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvYmplY3QpIHtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KG9iamVjdCwgZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgIHJldHVybiAodGhpc1trZXldIGluc3RhbmNlb2YgQXJyYXkpID8gdGhpc1trZXldIDogdmFsdWU7XG4gIH0pO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIGlzVVJJOiBmdW5jdGlvbih1cmkpIHtcbiAgICByZXR1cm4gdXJpICYmIHVyaS5wcm90b2NvbCAmJiB1cmkuaG9zdCAmJiB1cmkucGF0aDtcbiAgfSxcblxuICBpc1NhbWVPcmlnaW46IGZ1bmN0aW9uKHVyaSkge1xuICAgIHJldHVybiB1cmkucHJvdG9jb2wgPT09IGxvY2F0aW9uLnByb3RvY29sICYmXG4gICAgICAgICAgIHVyaS5ob3N0bmFtZSA9PT0gbG9jYXRpb24uaG9zdG5hbWUgJiZcbiAgICAgICAgICAgdXJpLnBvcnQgICAgID09PSBsb2NhdGlvbi5wb3J0O1xuICB9LFxuXG4gIHBhcnNlOiBmdW5jdGlvbih1cmwpIHtcbiAgICBpZiAodHlwZW9mIHVybCAhPT0gJ3N0cmluZycpIHJldHVybiB1cmw7XG4gICAgdmFyIHVyaSA9IHt9LCBwYXJ0cywgcXVlcnksIHBhaXJzLCBpLCBuLCBkYXRhO1xuXG4gICAgdmFyIGNvbnN1bWUgPSBmdW5jdGlvbihuYW1lLCBwYXR0ZXJuKSB7XG4gICAgICB1cmwgPSB1cmwucmVwbGFjZShwYXR0ZXJuLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgICB1cmlbbmFtZV0gPSBtYXRjaDtcbiAgICAgICAgcmV0dXJuICcnO1xuICAgICAgfSk7XG4gICAgICB1cmlbbmFtZV0gPSB1cmlbbmFtZV0gfHwgJyc7XG4gICAgfTtcblxuICAgIGNvbnN1bWUoJ3Byb3RvY29sJywgL15bYS16XStcXDovaSk7XG4gICAgY29uc3VtZSgnaG9zdCcsICAgICAvXlxcL1xcL1teXFwvXFw/I10rLyk7XG5cbiAgICBpZiAoIS9eXFwvLy50ZXN0KHVybCkgJiYgIXVyaS5ob3N0KVxuICAgICAgdXJsID0gbG9jYXRpb24ucGF0aG5hbWUucmVwbGFjZSgvW15cXC9dKiQvLCAnJykgKyB1cmw7XG5cbiAgICBjb25zdW1lKCdwYXRobmFtZScsIC9eW15cXD8jXSovKTtcbiAgICBjb25zdW1lKCdzZWFyY2gnLCAgIC9eXFw/W14jXSovKTtcbiAgICBjb25zdW1lKCdoYXNoJywgICAgIC9eIy4qLyk7XG5cbiAgICB1cmkucHJvdG9jb2wgPSB1cmkucHJvdG9jb2wgfHwgbG9jYXRpb24ucHJvdG9jb2w7XG5cbiAgICBpZiAodXJpLmhvc3QpIHtcbiAgICAgIHVyaS5ob3N0ICAgICA9IHVyaS5ob3N0LnN1YnN0cigyKTtcbiAgICAgIHBhcnRzICAgICAgICA9IHVyaS5ob3N0LnNwbGl0KCc6Jyk7XG4gICAgICB1cmkuaG9zdG5hbWUgPSBwYXJ0c1swXTtcbiAgICAgIHVyaS5wb3J0ICAgICA9IHBhcnRzWzFdIHx8ICcnO1xuICAgIH0gZWxzZSB7XG4gICAgICB1cmkuaG9zdCAgICAgPSBsb2NhdGlvbi5ob3N0O1xuICAgICAgdXJpLmhvc3RuYW1lID0gbG9jYXRpb24uaG9zdG5hbWU7XG4gICAgICB1cmkucG9ydCAgICAgPSBsb2NhdGlvbi5wb3J0O1xuICAgIH1cblxuICAgIHVyaS5wYXRobmFtZSA9IHVyaS5wYXRobmFtZSB8fCAnLyc7XG4gICAgdXJpLnBhdGggPSB1cmkucGF0aG5hbWUgKyB1cmkuc2VhcmNoO1xuXG4gICAgcXVlcnkgPSB1cmkuc2VhcmNoLnJlcGxhY2UoL15cXD8vLCAnJyk7XG4gICAgcGFpcnMgPSBxdWVyeSA/IHF1ZXJ5LnNwbGl0KCcmJykgOiBbXTtcbiAgICBkYXRhICA9IHt9O1xuXG4gICAgZm9yIChpID0gMCwgbiA9IHBhaXJzLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgICAgcGFydHMgPSBwYWlyc1tpXS5zcGxpdCgnPScpO1xuICAgICAgZGF0YVtkZWNvZGVVUklDb21wb25lbnQocGFydHNbMF0gfHwgJycpXSA9IGRlY29kZVVSSUNvbXBvbmVudChwYXJ0c1sxXSB8fCAnJyk7XG4gICAgfVxuXG4gICAgdXJpLnF1ZXJ5ID0gZGF0YTtcblxuICAgIHVyaS5ocmVmID0gdGhpcy5zdHJpbmdpZnkodXJpKTtcbiAgICByZXR1cm4gdXJpO1xuICB9LFxuXG4gIHN0cmluZ2lmeTogZnVuY3Rpb24odXJpKSB7XG4gICAgdmFyIHN0cmluZyA9IHVyaS5wcm90b2NvbCArICcvLycgKyB1cmkuaG9zdG5hbWU7XG4gICAgaWYgKHVyaS5wb3J0KSBzdHJpbmcgKz0gJzonICsgdXJpLnBvcnQ7XG4gICAgc3RyaW5nICs9IHVyaS5wYXRobmFtZSArIHRoaXMucXVlcnlTdHJpbmcodXJpLnF1ZXJ5KSArICh1cmkuaGFzaCB8fCAnJyk7XG4gICAgcmV0dXJuIHN0cmluZztcbiAgfSxcblxuICBxdWVyeVN0cmluZzogZnVuY3Rpb24ocXVlcnkpIHtcbiAgICB2YXIgcGFpcnMgPSBbXTtcbiAgICBmb3IgKHZhciBrZXkgaW4gcXVlcnkpIHtcbiAgICAgIGlmICghcXVlcnkuaGFzT3duUHJvcGVydHkoa2V5KSkgY29udGludWU7XG4gICAgICBwYWlycy5wdXNoKGVuY29kZVVSSUNvbXBvbmVudChrZXkpICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5W2tleV0pKTtcbiAgICB9XG4gICAgaWYgKHBhaXJzLmxlbmd0aCA9PT0gMCkgcmV0dXJuICcnO1xuICAgIHJldHVybiAnPycgKyBwYWlycy5qb2luKCcmJyk7XG4gIH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBhcnJheSA9IHJlcXVpcmUoJy4vYXJyYXknKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbihvcHRpb25zLCB2YWxpZEtleXMpIHtcbiAgZm9yICh2YXIga2V5IGluIG9wdGlvbnMpIHtcbiAgICBpZiAoYXJyYXkuaW5kZXhPZih2YWxpZEtleXMsIGtleSkgPCAwKVxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbnJlY29nbml6ZWQgb3B0aW9uOiAnICsga2V5KTtcbiAgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIFdTID0gZ2xvYmFsLk1veldlYlNvY2tldCB8fCBnbG9iYWwuV2ViU29ja2V0O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgY3JlYXRlOiBmdW5jdGlvbih1cmwsIHByb3RvY29scywgb3B0aW9ucykge1xuICAgIGlmICh0eXBlb2YgV1MgIT09ICdmdW5jdGlvbicpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBuZXcgV1ModXJsKTtcbiAgfVxufTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxudmFyIHByb2Nlc3MgPSBtb2R1bGUuZXhwb3J0cyA9IHt9O1xuXG4vLyBjYWNoZWQgZnJvbSB3aGF0ZXZlciBnbG9iYWwgaXMgcHJlc2VudCBzbyB0aGF0IHRlc3QgcnVubmVycyB0aGF0IHN0dWIgaXRcbi8vIGRvbid0IGJyZWFrIHRoaW5ncy4gIEJ1dCB3ZSBuZWVkIHRvIHdyYXAgaXQgaW4gYSB0cnkgY2F0Y2ggaW4gY2FzZSBpdCBpc1xuLy8gd3JhcHBlZCBpbiBzdHJpY3QgbW9kZSBjb2RlIHdoaWNoIGRvZXNuJ3QgZGVmaW5lIGFueSBnbG9iYWxzLiAgSXQncyBpbnNpZGUgYVxuLy8gZnVuY3Rpb24gYmVjYXVzZSB0cnkvY2F0Y2hlcyBkZW9wdGltaXplIGluIGNlcnRhaW4gZW5naW5lcy5cblxudmFyIGNhY2hlZFNldFRpbWVvdXQ7XG52YXIgY2FjaGVkQ2xlYXJUaW1lb3V0O1xuXG5mdW5jdGlvbiBkZWZhdWx0U2V0VGltb3V0KCkge1xuICAgIHRocm93IG5ldyBFcnJvcignc2V0VGltZW91dCBoYXMgbm90IGJlZW4gZGVmaW5lZCcpO1xufVxuZnVuY3Rpb24gZGVmYXVsdENsZWFyVGltZW91dCAoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdjbGVhclRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbihmdW5jdGlvbiAoKSB7XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBzZXRUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBkZWZhdWx0U2V0VGltb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgaWYgKHR5cGVvZiBjbGVhclRpbWVvdXQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG4gICAgICAgIH1cbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGRlZmF1bHRDbGVhclRpbWVvdXQ7XG4gICAgfVxufSAoKSlcbmZ1bmN0aW9uIHJ1blRpbWVvdXQoZnVuKSB7XG4gICAgaWYgKGNhY2hlZFNldFRpbWVvdXQgPT09IHNldFRpbWVvdXQpIHtcbiAgICAgICAgLy9ub3JtYWwgZW52aXJvbWVudHMgaW4gc2FuZSBzaXR1YXRpb25zXG4gICAgICAgIHJldHVybiBzZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfVxuICAgIC8vIGlmIHNldFRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRTZXRUaW1lb3V0ID09PSBkZWZhdWx0U2V0VGltb3V0IHx8ICFjYWNoZWRTZXRUaW1lb3V0KSAmJiBzZXRUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZFNldFRpbWVvdXQgPSBzZXRUaW1lb3V0O1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0KGZ1biwgMCk7XG4gICAgfSBjYXRjaChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZFNldFRpbWVvdXQuY2FsbChudWxsLCBmdW4sIDApO1xuICAgICAgICB9IGNhdGNoKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3JcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwodGhpcywgZnVuLCAwKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG59XG5mdW5jdGlvbiBydW5DbGVhclRpbWVvdXQobWFya2VyKSB7XG4gICAgaWYgKGNhY2hlZENsZWFyVGltZW91dCA9PT0gY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIC8vIGlmIGNsZWFyVGltZW91dCB3YXNuJ3QgYXZhaWxhYmxlIGJ1dCB3YXMgbGF0dGVyIGRlZmluZWRcbiAgICBpZiAoKGNhY2hlZENsZWFyVGltZW91dCA9PT0gZGVmYXVsdENsZWFyVGltZW91dCB8fCAhY2FjaGVkQ2xlYXJUaW1lb3V0KSAmJiBjbGVhclRpbWVvdXQpIHtcbiAgICAgICAgY2FjaGVkQ2xlYXJUaW1lb3V0ID0gY2xlYXJUaW1lb3V0O1xuICAgICAgICByZXR1cm4gY2xlYXJUaW1lb3V0KG1hcmtlcik7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIC8vIHdoZW4gd2hlbiBzb21lYm9keSBoYXMgc2NyZXdlZCB3aXRoIHNldFRpbWVvdXQgYnV0IG5vIEkuRS4gbWFkZG5lc3NcbiAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgLy8gV2hlbiB3ZSBhcmUgaW4gSS5FLiBidXQgdGhlIHNjcmlwdCBoYXMgYmVlbiBldmFsZWQgc28gSS5FLiBkb2Vzbid0ICB0cnVzdCB0aGUgZ2xvYmFsIG9iamVjdCB3aGVuIGNhbGxlZCBub3JtYWxseVxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKG51bGwsIG1hcmtlcik7XG4gICAgICAgIH0gY2F0Y2ggKGUpe1xuICAgICAgICAgICAgLy8gc2FtZSBhcyBhYm92ZSBidXQgd2hlbiBpdCdzIGEgdmVyc2lvbiBvZiBJLkUuIHRoYXQgbXVzdCBoYXZlIHRoZSBnbG9iYWwgb2JqZWN0IGZvciAndGhpcycsIGhvcGZ1bGx5IG91ciBjb250ZXh0IGNvcnJlY3Qgb3RoZXJ3aXNlIGl0IHdpbGwgdGhyb3cgYSBnbG9iYWwgZXJyb3IuXG4gICAgICAgICAgICAvLyBTb21lIHZlcnNpb25zIG9mIEkuRS4gaGF2ZSBkaWZmZXJlbnQgcnVsZXMgZm9yIGNsZWFyVGltZW91dCB2cyBzZXRUaW1lb3V0XG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkQ2xlYXJUaW1lb3V0LmNhbGwodGhpcywgbWFya2VyKTtcbiAgICAgICAgfVxuICAgIH1cblxuXG5cbn1cbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGlmICghZHJhaW5pbmcgfHwgIWN1cnJlbnRRdWV1ZSkge1xuICAgICAgICByZXR1cm47XG4gICAgfVxuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHJ1blRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIHJ1bkNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHJ1blRpbWVvdXQoZHJhaW5RdWV1ZSk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcbnByb2Nlc3MucHJlcGVuZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucHJlcGVuZE9uY2VMaXN0ZW5lciA9IG5vb3A7XG5cbnByb2Nlc3MubGlzdGVuZXJzID0gZnVuY3Rpb24gKG5hbWUpIHsgcmV0dXJuIFtdIH1cblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iXX0=
