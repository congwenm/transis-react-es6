import React, { Component } from 'react'
import ReactDOM from 'react-dom'
import Transis from 'transis'

// Note: not exactly sure when this is needed: work around for this multiple instance issue
// let mundo; try { mundo = window } catch (e) { mundo = global }
// const Transis = mundo.Transis || MyTransis

// copied from transis
let nextId = 1;
let updateLog = {};
export let updateQueue = {};

function componentComparison(a, b) {
  if (a._transisId < b._transisId) { return -1; }
  else if (a._transisId > b._transisId) { return 1; }
  else { return 0; }
}

function preFlush() {
  updateLog = {};
  Transis.Object.delay(postFlush);
}

function postFlush() {
  let components = [];

  // console.warn('post flush triggered')
  for (let id in updateQueue) {
    components.push(updateQueue[id]);
    delete updateQueue[id];
  }

  // Sort the components by their assigned _transisId. Since components get mounted from the top
  // down, this should ensure that parent components are force updated before any descendent
  // components that also need an update. This avoids the case where we force update a component
  // and then force update one of its ancestors, which may unnecessarily render the component
  // again.
  components.sort(componentComparison).forEach(function(component) {
    if (!updateLog[component._transisId] && ReactDOM.findDOMNode(component)) { // has mounted
      component.forceUpdate();
    }
  });

  Transis.Object.delayPreFlush(preFlush);
}

function queueUpdate(component) {
  // console.warn('queueUpdate')
  updateQueue[component._transisId] = component;
}

function logUpdate(component) {
  updateLog[component._transisId] = true;
}

Transis.Object.delayPreFlush(preFlush);

// end of copied from transis


// * Refactor Effort *
// @param {TransisObject} globalTransisObjectVar - transis object attached to some globalTransisObject namespace
// @param {Array} attrsToWatch - props on the globalTransisObjectVar that the component should watch for
const bindState = (globalTransisObjectVar, attrsToWatch, callback) => {
  if (globalTransisObjectVar && typeof globalTransisObjectVar.on === 'function') {
    attrsToWatch.forEach(attrPath =>
      globalTransisObjectVar.on(attrPath, callback)
    )
  }
}

const unbindState = (stateVar, attrsToWatch, callback) => {
  if (stateVar && typeof stateVar.off === 'function') {
    attrsToWatch.forEach(attrPath =>
      stateVar.off(attrPath, callback)
    )
  }
}

const unbindProps = (propsVar, attrsToWatch, callback) => {
  attrsToWatch.forEach(attrPath =>
    propsVar && propsVar.off(attrPath, callback)
  )
}

const bindProps = (propsVar, attrsToWatch, callback) => {
  attrsToWatch.forEach(attrPath =>
    propsVar && propsVar.on(attrPath, callback)
  )
}

// component will mount
const componentWillMount = function({ globalTransisObject, state, props }) {
  if (state || props) {
      // setting transis id
    this._transisId = this._transisId || nextId++;

    // setting main update function
    const wrapQueueUpdate = () => { queueUpdate(this) } // name this function
    this._transisQueueUpdate = this._transisQueueUpdate || wrapQueueUpdate;
  }
  if (state) {
    // core register sync method
    this._transisSyncState = () => {
      // console.warn('transis sync update triggered')

      var stateToUpdate = {};
      for (let k in state) {
        if (this.state[k] !== globalTransisObject[k]) {
          // local state is out of date, off syncing it
          unbindState(this.state[k], state[k], this._transisQueueUpdate)

          // globalTransisObject state needs to be attached, on syncing it
          bindState(globalTransisObject[k], state[k], this._transisQueueUpdate)

          stateToUpdate[k] = globalTransisObject[k];
        }
      } // end of for loop

      if (Object.keys(stateToUpdate).length) {
        this.setState(stateToUpdate);
      }
    }

    for (let k in state) { // loop through states, on sync all states initially
      bindState(globalTransisObject[k], state[k], this._transisQueueUpdate)
    }

    globalTransisObject.on('*', this._transisSyncState)
  }

  if (props) {
    for (let k in props) {
      bindProps(this.props[k], props[k], this._transisQueueUpdate)
    }
  }
} // end of Component Will Mount Factory
// * end Refactor Effort *

// main constructor
const transisAware = (
  { global: globalTransisObject, state, props },
  ComposedComponent,
) => {
  if (!globalTransisObject && state) {
    throw new Error("Cannot compose with-state component without global transis object, state: ", state)
  }

  // TODO: convert prop into into an object of empty arrays
  // e.g.
  //    StateMixin({}, 'a', 'b', 'c')
  //  ->
  //    props {}= { a: [], b: [], c: [] }
  if (({}).toString.call(state).includes('Array')) { // is an array
    state = state.reduce((obj, stateName) => {
      obj[stateName] = []
      return obj
    }, {})
  }

  const higherOrderComponent = class HigherOrderComponent extends React.Component {
    // allow both component will mount to get triggered
    componentWillMount = () => {
      return componentWillMount.call(this, {
        globalTransisObject, state, props
      })
    }

    componentDidMount = () => logUpdate(this)
    componentDidUpdate = () => logUpdate(this)

    componentWillUnmount = () => {
      if (state) {
        for (let k in state) {
          unbindState(this.state[k], state[k], this._transisQueueUpdate)
        }
        globalTransisObject.off('*', this._transisSyncState);
      }
      if (props) {
        for (let k in props) {
          unbindProps(this.props[k], props[k], this._transisQueueUpdate)
        }
      }
    };

    constructor(propArgs) {
      super(propArgs)
      if (state) {
        // initialize State
        this.state = Object.keys(state).reduce((result, key) => {
          result[key] = globalTransisObject[key]
          return result
        }, {})
      }
      if (props) {
        this.componentWillReceiveProps = (nextProps) => {
          // console.warn('component will receive props', nextProps)
          for (let k in props) {
            props[k].forEach(prop => {
              if (nextProps[k] !== this.props[k]) {
                if (this.props[k]) {
                  this.props[k].off(prop, this._transisQueueUpdate);
                }
                if (nextProps[k]) {
                  nextProps[k].on(prop, this._transisQueueUpdate);
                }
              }
            });
          }
        }
      }
    }

    render = () => <ComposedComponent {...this.props} {...this.state} />
  };
  return higherOrderComponent;
}

transisAware.Transis = Transis // for verifying Transis instances

export default transisAware