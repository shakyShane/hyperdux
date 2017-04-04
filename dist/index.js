"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Rx = require("rx");
var Immutable = require("immutable");
var actions_1 = require("./actions");
var responses_1 = require("./responses");
var addReducers_1 = require("./addReducers");
var addEffects_1 = require("./addEffects");
var BehaviorSubject = Rx.BehaviorSubject;
var Subject = Rx.Subject;
var ReducerTypes;
(function (ReducerTypes) {
    ReducerTypes[ReducerTypes["MappedReducer"] = 'MappedReducer'] = "MappedReducer";
    ReducerTypes[ReducerTypes["GlobalReducer"] = 'GlobalReducer'] = "GlobalReducer";
})(ReducerTypes = exports.ReducerTypes || (exports.ReducerTypes = {}));
function createStore(initialState, initialReducers, initialEffects, initialMiddleware, initialExtras) {
    var mergedInitialState = alwaysMap(initialState);
    var state$ = new BehaviorSubject(mergedInitialState);
    var userExtra$ = new BehaviorSubject({});
    var newExtras$ = new Subject();
    newExtras$.scan(function (extras, incoming) {
        return Object.assign({}, extras, incoming);
    }, {}).subscribe(userExtra$);
    // reducers to act upon state
    var storeReducers = new BehaviorSubject([]);
    var newReducer$ = new Subject();
    newReducer$.scan(function (acc, incoming) {
        return acc.concat(incoming);
    }, []).subscribe(storeReducers);
    // Mapped reducers
    var mappedReducers = new BehaviorSubject([]);
    var newMappedReducer$ = new Subject();
    newMappedReducer$.scan(function (acc, incoming) {
        return acc.concat(incoming);
    }, []).subscribe(mappedReducers);
    // responses
    var storeResponses = new BehaviorSubject([]);
    var newResponses = new Subject();
    newResponses.scan(function (acc, incoming) {
        return acc.concat(incoming);
    }, []).subscribe(storeResponses);
    // stream of actions
    var action$ = new Subject();
    // stream
    actions_1.actionStream(mergedInitialState, action$, storeReducers, mappedReducers)
        .catch(function (err) {
        // console.error(err);
        return Rx.Observable.throw(err);
    })
        .subscribe(state$);
    /**
     * Create a stream that has updates + resulting state updates
     */
    var actionsWithState$ = action$.withLatestFrom(state$, function (action, state) {
        return {
            action: action,
            state: state
        };
    });
    /**
     * Setup responses for declarative cross-domain communication
     */
    responses_1.handleResponses(actionsWithState$, storeResponses)
        .subscribe(function (action) { return _dispatcher(action); });
    /**
     * Default extras that get passed to all 'effects'
     */
    var storeExtras = {
        state$: state$,
        action$: action$,
        actionsWithState$: actionsWithState$,
        actionsWithResultingStateUpdate$: actionsWithState$
    };
    /**
     * Dispatch 1 or many actions
     * @param action
     * @returns {*}
     * @private
     */
    function _dispatcher(action) {
        if (Array.isArray(action)) {
            return action.forEach(function (a) {
                action$.onNext(a);
            });
        }
        return action$.onNext(action);
    }
    function _addEffects(incoming) {
        addEffects_1.addEffects(incoming, actionsWithState$, storeExtras, userExtra$, _dispatcher);
    }
    function _addMiddleware(middleware) {
        alwaysArray(middleware).forEach(function (middleware) {
            middleware.call(null, api);
        });
    }
    function _addExtras(extras) {
        alwaysArray(extras).forEach(function (extra) {
            newExtras$.onNext(extra);
        });
    }
    function _registerOnStateTree(state) {
        for (var key in state) {
            // now init with action
            _dispatcher({
                type: '@@NS-INIT(' + key + ')',
                payload: {
                    path: [key],
                    value: state[key]
                }
            });
        }
    }
    function _addResponses(responses) {
        alwaysArray(responses).forEach(function (resp) {
            Object.keys(resp).forEach(function (actionName) {
                var item = resp[actionName];
                newResponses.onNext({
                    name: actionName,
                    path: [].concat(item.path).filter(Boolean),
                    targetName: item.action
                });
            });
        });
    }
    function _addReducers(incoming) {
        addReducers_1.addReducers(incoming, newReducer$, newMappedReducer$, _addEffects, _registerOnStateTree);
    }
    var api = {
        state$: state$,
        action$: action$,
        actionsWithState$: actionsWithState$,
        actionsWithResultingStateUpdate$: actionsWithState$,
        register: function (input) {
            var state = input.state, reducers = input.reducers, effects = input.effects, responses = input.responses;
            if (state) {
                _registerOnStateTree(state);
            }
            if (reducers) {
                _addReducers(reducers);
            }
            if (effects) {
                _addEffects(effects);
            }
            if (responses) {
                _addResponses(responses);
            }
            return api;
        },
        addReducers: function (reducers) {
            _addReducers(reducers);
            return api;
        },
        dispatch: function (action) {
            _dispatcher(action);
            return api;
        },
        getState: function (path) {
            var lookup = alwaysArray(path);
            return state$.getValue().getIn(lookup, getMap({}));
        },
        toJS: function (path) {
            var lookup = alwaysArray(path);
            return state$.getValue().getIn(lookup, getMap({})).toJS();
        },
        toJSON: function (path) {
            var lookup = alwaysArray(path);
            return state$.getValue().getIn(lookup, getMap({})).toJSON();
        },
        addMiddleware: function (middleware) {
            _addMiddleware(middleware);
            return api;
        },
        once: function (actions) {
            var lookup = alwaysArray(actions);
            return actionsWithState$.filter(function (x) {
                return lookup.indexOf(x.action.type) > -1;
            }).take(1);
        },
        changes: function (path) {
            var lookup = alwaysArray(path);
            return state$.map(function (x) { return x.getIn(lookup); })
                .distinctUntilChanged();
        }
    };
    // add initial ones
    _addReducers(initialReducers);
    _addEffects(initialEffects);
    _addMiddleware(initialMiddleware);
    _addExtras(initialExtras);
    return api;
}
exports.createStore = createStore;
function alwaysArray(input) {
    return [].concat(input).filter(Boolean);
}
exports.alwaysArray = alwaysArray;
function getMap(incoming) {
    return Immutable.Map(incoming);
}
exports.getMap = getMap;
function alwaysMap(input) {
    return Immutable.Map.isMap(input) ? input : Immutable.fromJS(input || {});
}
exports.alwaysMap = alwaysMap;
function isPlainObject(value) {
    var objectTag = '[object Object]';
    return Object.prototype.toString.call(value) === objectTag;
}
exports.isPlainObject = isPlainObject;
exports.default = createStore;
if ((typeof window !== 'undefined') && ((typeof window.staunch) === 'undefined')) {
    window.staunch = {
        createStore: createStore
    };
}
//# sourceMappingURL=index.js.map