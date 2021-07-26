// Copyright (C) 2019 Agoric, under Apache license 2.0

// @ts-check

import { assert, details as X, q } from '@agoric/assert';
import { passStyleOf, Far } from '@agoric/marshal';
import './types.js';

const assertKey = (key, passableOnly) => {
  if (passableOnly) {
    harden(key); // TODO: Just a transition kludge. Remove when possible.
    assert.equal(
      passStyleOf(key),
      'remotable',
      X`WeakStores accept only identity-based keys: ${key}`,
    );
  }
};

const assertValue = (value, passableOnly) => {
  if (passableOnly) {
    harden(value); // TODO: Just a transition kludge. Remove when possible.
    passStyleOf(value); // asserts that value is passable
  }
};

/**
 * @typedef {Object} WeakStoreOptions
 * @property {boolean=} longLived Which way to optimize. True means that we
 * expect this weakStore to outlive longer than most of its keys, in which
 * case we internally use a `WeakMap`. Otherwise we internally use a `Map`.
 * Defaults to true, so please mark short lived tables explicitly
 * @property {boolean=} passableOnly transitional. Defaults to false.
 * But beware the default passableOnly will switch to true and ultimately be
 * retired.
 */

/**
 * @template {Record<any, any>} K
 * @template {any} V
 * @param {string} [keyName='key']
 * @param {Partial<WeakStoreOptions>=} options
 * @returns {WeakStore<K, V>}
 */
export function makeWeakStore(
  keyName = 'key',
  { longLived = true, passableOnly = true } = {},
) {
  const wm = new (longLived ? WeakMap : Map)();
  const assertKeyDoesNotExist = key =>
    assert(!wm.has(key), X`${q(keyName)} already registered: ${key}`);
  const assertKeyExists = key =>
    assert(wm.has(key), X`${q(keyName)} not found: ${key}`);
  return Far('weakStore', {
    has: key => {
      assertKey(key, passableOnly);
      return wm.has(key);
    },
    init: (key, value) => {
      assertKey(key, passableOnly);
      assertValue(value, passableOnly);
      assertKeyDoesNotExist(key);
      wm.set(key, value);
    },
    get: key => {
      assertKey(key, passableOnly);
      assertKeyExists(key);
      return wm.get(key);
    },
    set: (key, value) => {
      assertKey(key, passableOnly);
      assertValue(value, passableOnly);
      assertKeyExists(key);
      wm.set(key, value);
    },
    delete: key => {
      assertKey(key, passableOnly);
      assertKeyExists(key);
      wm.delete(key);
    },
  });
}
harden(makeWeakStore);
