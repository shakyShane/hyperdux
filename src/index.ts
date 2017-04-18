import Immutable = require('immutable');
import {Observable} from 'rxjs/Observable';
import {actionStream} from "./actions";
import {handleResponses} from "./responses";
import {gatherReducers, InputTypes} from "./addReducers";
import {gatherEffects} from "./addEffects";
import {concatFn, assignFn} from "./subjects";

import {BehaviorSubject} from 'rxjs/BehaviorSubject';
import {Subject} from 'rxjs/Subject';

import 'rxjs/add/operator/scan';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/withLatestFrom';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/switchMap';
import 'rxjs/add/operator/distinctUntilChanged';
import 'rxjs/add/operator/startWith';
import 'rxjs/add/operator/take';
import 'rxjs/add/observable/of';

export enum ReducerTypes {
    MappedReducer = <any>'MappedReducer',
    GlobalReducer = <any>'GlobalReducer'
}

export function createStore(initialState,
                            initialReducers,
                            initialEffects,
                            initialMiddleware,
                            initialExtras) {

    const mergedInitialState = alwaysMap(initialState);
    const state$             = new BehaviorSubject(mergedInitialState);
    const subs = [];

    const userExtra$ = new BehaviorSubject({});
    const newExtras$ = new Subject();
    subs.push(newExtras$.scan(assignFn, {}).subscribe(userExtra$));

    // reducers to act upon state
    const storeReducers = new BehaviorSubject([]);
    const newReducer$ = new Subject();
    subs.push(newReducer$.scan(concatFn, []).subscribe(storeReducers));

    // Mapped reducers
    const mappedReducers = new BehaviorSubject([]);
    const newMappedReducer$ = new Subject();
    subs.push(newMappedReducer$.scan(concatFn, []).subscribe(mappedReducers));

    // responses
    const storeResponses = new BehaviorSubject([]);
    const newResponses = new Subject();
    subs.push(newResponses.scan(concatFn, []).subscribe(storeResponses));

    // stream of actions
    const action$ = new Subject();

    // stream
    subs.push(actionStream(mergedInitialState, action$, storeReducers, mappedReducers)
        .subscribe(state$));

    /**
     * Create a stream that has updates + resulting state updates
     */
    const actionsWithState$ = action$.withLatestFrom(state$, function (action, state) {
        return {
            action,
            state
        }
    });

    /**
     * Setup responses for declarative cross-domain communication
     */
    subs.push(handleResponses(actionsWithState$, storeResponses)
        .subscribe(action => _dispatcher(action)));

    /**
     * Default extras that get passed to all 'effects'
     */
    const storeExtras = {
        state$,
        action$,
        actionsWithState$,
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
            return action.forEach(function(a) {
                action$.next(a)
            });
        }
        return action$.next(action);
    }



    function _addMiddleware(middleware) {
        alwaysArray(middleware).forEach(function (middleware) {
            middleware.call(null, api);
        })
    }

    function _addExtras(extras) {
        alwaysArray(extras).forEach(function (extra) {
            newExtras$.next(extra);
        });
    }

    function _registerOnStateTree(state) {
        for (let key in state) {
            // now init with action
            _dispatcher({
                type: '@@NS-INIT('+ key +')',
                payload: {
                    path: [key],
                    value: state[key]
                }
            });
        }
    }

    function _addResponses (responses) {
        alwaysArray(responses).forEach(function (resp) {
            Object.keys(resp).forEach(function (actionName) {
                const item = resp[actionName];
                newResponses.next({
                    name: actionName,
                    path: [].concat(item.path).filter(Boolean),
                    targetName: item.action
                });
            });
        });
    }

    function _addEffects(incoming) {
        gatherEffects(incoming, actionsWithState$, storeExtras, userExtra$)
            .forEach(outgoing => {
                if (outgoing.type === InputTypes.Effect) {
                    subs.push(outgoing.payload.subscribe(_dispatcher));
                }
            });
    }

    function _addReducers(incoming) {
        gatherReducers(incoming)
            .forEach(outgoing => {
                if (outgoing.type === InputTypes.Reducer) {
                    newReducer$.next(outgoing.payload);
                }
                if (outgoing.type === InputTypes.MappedReducer) {
                    newMappedReducer$.next(outgoing.payload);
                }
                if (outgoing.type === InputTypes.State) {
                    _registerOnStateTree(outgoing.payload);
                }
            })
    }

    const api = {
        isOpen: true,
        state$: state$,
        action$: action$,
        actionsWithState$: actionsWithState$,
        actionsWithResultingStateUpdate$: actionsWithState$,
        register: function (input) {
            const {state, reducers, effects, responses} = input;

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
            const lookup = alwaysArray(path);
            return state$.getValue().getIn(lookup, getMap({}));
        },
        toJS: function (path) {
            const lookup = alwaysArray(path);
            return state$.getValue().getIn(lookup, getMap({})).toJS();
        },
        toJSON: function (path) {
            const lookup = alwaysArray(path);
            return state$.getValue().getIn(lookup, getMap({})).toJSON();
        },
        addMiddleware: function (middleware) {
            _addMiddleware(middleware);
            return api;
        },
        once: function (actions) {
            const lookup = alwaysArray(actions);
            return actionsWithState$.filter((x: {action: any}) => {
                return lookup.indexOf(x.action.type) > -1;
            }).take(1);
        },
        changes: function (path) {
            const lookup = alwaysArray(path);
            return state$.map(x => x.getIn(lookup))
                .distinctUntilChanged();
        },
        addExtras: function(extras) {
            _addExtras(extras);
            return api;
        },
        close: function() {
            if (api.isOpen) {
                subs.forEach(sub => sub.unsubscribe());
                api.isOpen = false;
            }
            return api;
        }
    };

    // add initial ones
    _addReducers(initialReducers);
    _addEffects(initialEffects);
    _addMiddleware(initialMiddleware);
    _addExtras(initialExtras);

    return api;
}

export function alwaysArray (input) {
    return [].concat(input).filter(Boolean)
}
export function getMap(incoming) {
    return Immutable.Map(incoming);
}

export function alwaysMap (input) {
    return Immutable.Map.isMap(input) ? input : Immutable.fromJS(input || {})
}

export function isPlainObject(value) {
    const objectTag = '[object Object]';

    return Object.prototype.toString.call(value) === objectTag;
}

export default createStore;

if ((typeof window !== 'undefined') && ((typeof window.staunch) === 'undefined')) {
    window.staunch = {
        createStore
    };
}
