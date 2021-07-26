// Copyright (C) 2019 Agoric, under Apache license 2.0

// @ts-check

import { assert, details as X, q } from '@agoric/assert';
import { passStyleOf, Far } from '@agoric/marshal';
import { mustBeComparable } from '../../same-structure';

const assertKey = (key, passableOnly) => {
  if (passableOnly) {
    harden(key); // TODO: Just a transition kludge. Remove when possible.
    mustBeComparable(key);
    assert.equal(
      passStyleOf(key),
      'remotable',
      X`Only identity-based keys accepted for now: ${key}`,
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
 * @typedef {Object} StoreOptions
 * @property {boolean=} longLived Which way to optimize. True means that we
 * expect this weakStore to outlive longer than most of its keys, in which
 * case we internally use a `WeakMap`. Otherwise we internally use a `Map`.
 * TODO Once we are happy with a default, mention it here.
 * @property {boolean=} passableOnly transitional. Defaults to falso.
 * But beware the default passableOnly will switch to true and ultimately be
 * retired.
 */

/**
 * Distinguishes between adding a new key (init) and updating or
 * referencing a key (get, set, delete).
 *
 * `init` is only allowed if the key does not already exist. `Get`,
 * `set` and `delete` are only allowed if the key does already exist.
 *
 * @template K,V
 * @param {string} [keyName='key'] - the column name for the key
 * @param {Partial<StoreOptions>=} options
 * @returns {Store<K,V>}
 */
export function makeStore(keyName = 'key', { passableOnly = true } = {}) {
  const store = new Map();
  const assertKeyDoesNotExist = key =>
    assert(!store.has(key), X`${q(keyName)} already registered: ${key}`);
  const assertKeyExists = key =>
    assert(store.has(key), X`${q(keyName)} not found: ${key}`);
  return Far('store', {
    has: key => {
      assertKey(key, passableOnly);
      return store.has(key);
    },
    init: (key, value) => {
      assertKey(key, passableOnly);
      assertValue(value, passableOnly);
      assertKeyDoesNotExist(key);
      store.set(key, value);
    },
    get: key => {
      assertKey(key, passableOnly);
      assertKeyExists(key);
      return store.get(key);
    },
    set: (key, value) => {
      assertKey(key, passableOnly);
      assertValue(value, passableOnly);
      assertKeyExists(key);
      store.set(key, value);
    },
    delete: key => {
      assertKey(key, passableOnly);
      assertKeyExists(key);
      store.delete(key);
    },
    keys: () => Array.from(store.keys()),
    values: () => Array.from(store.values()),
    entries: () => Array.from(store.entries()),
  });
}
harden(makeStore);
