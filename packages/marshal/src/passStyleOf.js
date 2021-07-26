// @ts-check

// eslint-disable-next-line spaced-comment
/// <reference types="ses"/>

import { assert, details as X, q } from '@agoric/assert';
import { isPromise } from '@agoric/promise-kit';

import './types.js';
import '@agoric/assert/exported.js';

// Setting this flag to true is what allows objects with `null` or
// `Object.prototype` prototypes to be treated as remotable.  Setting to `false`
// means that only objects declared with `Remotable(...)`, including `Far(...)`
// can be used as remotables.
//
// TODO: once the policy changes to force remotables to be explicit, remove this
// flag entirely and fix code that uses it (as if it were always `false`).
//
// Exported only for testing during the transition
export const ALLOW_IMPLICIT_REMOTABLES = true;

const {
  getPrototypeOf,
  getOwnPropertyDescriptors,
  isFrozen,
  prototype: objectPrototype,
} = Object;

const { prototype: functionPrototype } = Function;

const { ownKeys } = Reflect;

export const PASS_STYLE = Symbol.for('passStyle');

const errorConstructors = new Map([
  ['Error', Error],
  ['EvalError', EvalError],
  ['RangeError', RangeError],
  ['ReferenceError', ReferenceError],
  ['SyntaxError', SyntaxError],
  ['TypeError', TypeError],
  ['URIError', URIError],
]);

export function getErrorConstructor(name) {
  return errorConstructors.get(name);
}

/**
 * For most of these classification tests, we do strict validity `assert`s,
 * throwing if we detect something invalid. For errors, we need to remember
 * the error itself exists to help us diagnose a bug that's likely more
 * pressing than a validity bug in the error itself. Thus, whenever it is safe
 * to do so, we prefer to let the error test succeed and to couch these
 * complaints as notes on the error.
 *
 * @param {Passable} val
 * @returns {boolean}
 */
function isPassByCopyError(val) {
  // TODO: Need a better test than instanceof
  if (!(val instanceof Error)) {
    return false;
  }
  const proto = getPrototypeOf(val);
  const { name } = val;
  const EC = getErrorConstructor(name);
  if (!EC || EC.prototype !== proto) {
    assert.note(
      val,
      X`Errors must inherit from an error class .prototype ${val}`,
    );
  }

  const {
    message: mDesc,
    // Allow but ignore only extraneous own `stack` property.
    stack: _optStackDesc,
    ...restDescs
  } = getOwnPropertyDescriptors(val);
  if (ownKeys(restDescs).length >= 1) {
    assert.note(
      val,
      X`Passed Error has extra unpassed properties ${restDescs}`,
    );
  }
  if (mDesc) {
    if (typeof mDesc.value !== 'string') {
      assert.note(
        val,
        X`Passed Error "message" ${mDesc} must be a string-valued data property.`,
      );
    }
    if (mDesc.enumerable) {
      assert.note(
        val,
        X`Passed Error "message" ${mDesc} must not be enumerable`,
      );
    }
  }
  return true;
}

/**
 * @param {Passable} val
 * @returns {boolean}
 */
function isPassByCopyArray(val) {
  if (!Array.isArray(val)) {
    return false;
  }
  assert(
    getPrototypeOf(val) === Array.prototype,
    X`Malformed array: ${val}`,
    TypeError,
  );
  const len = val.length;
  const descs = getOwnPropertyDescriptors(val);
  for (let i = 0; i < len; i += 1) {
    const desc = descs[i];
    assert(desc, X`Arrays must not contain holes: ${q(i)}`, TypeError);
    assert(
      'value' in desc,
      X`Arrays must not contain accessors: ${q(i)}`,
      TypeError,
    );
    assert(
      typeof desc.value !== 'function',
      X`Arrays must not contain methods: ${q(i)}`,
      TypeError,
    );
    assert(
      desc.enumerable,
      X`Array elements must be enumerable: ${q(i)}`,
      TypeError,
    );
  }
  assert(
    ownKeys(descs).length === len + 1,
    X`Arrays must not have non-indexes: ${val}`,
    TypeError,
  );
  return true;
}

/**
 * @param {Passable} val
 * @returns {boolean}
 */
function isPassByCopyRecord(val) {
  const proto = getPrototypeOf(val);
  if (proto !== objectPrototype && proto !== null) {
    return false;
  }
  const descs = getOwnPropertyDescriptors(val);
  const descKeys = ownKeys(descs);

  for (const descKey of descKeys) {
    if (typeof descKey === 'symbol') {
      return false;
    }
    const desc = descs[descKey];
    if (typeof desc.value === 'function') {
      return false;
    }
  }
  for (const descKey of descKeys) {
    assert.typeof(
      descKey,
      'string',
      X`Pass by copy records can only have string-named own properties`,
    );
    const desc = descs[descKey];
    assert(
      !('get' in desc),
      X`Records must not contain accessors: ${q(descKey)}`,
      TypeError,
    );
    assert(
      desc.enumerable,
      X`Record fields must be enumerable: ${q(descKey)}`,
      TypeError,
    );
  }
  return true;
}

// Below we have a series of predicate functions and their (curried) assertion
// functions. The semantics of the assertion function is just to assert that
// the corresponding predicate function would have returned true. But it
// reproduces the internal tests so failures can give a better error message.

/**
 * @callback Checker
 * @param {boolean} cond
 * @param {Details=} details
 * @returns {boolean}
 */

/** @type {Checker} */
const assertChecker = (cond, details) => {
  assert(cond, details);
  return true;
};

/**
 * @param {InterfaceSpec} iface
 * @param {Checker} check
 */
const checkIface = (iface, check = x => x) => {
  return (
    // TODO other possible ifaces, once we have third party veracity
    check(
      typeof iface === 'string',
      X`Interface ${iface} must be a string; unimplemented`,
    ) &&
    check(
      iface === 'Remotable' || iface.startsWith('Alleged: '),
      X`For now, iface ${q(
        iface,
      )} must be "Remotable" or begin with "Alleged: "; unimplemented`,
    )
  );
};

/**
 * @param {InterfaceSpec} iface
 */
const assertIface = iface => checkIface(iface, assertChecker);
harden(assertIface);
export { assertIface };

/**
 * @param {any} original
 * @param {Checker} [check]
 * @returns {boolean}
 */
const checkRemotableProtoOf = (original, check = x => x) => {
  /**
   * TODO: It would be nice to typedef this shape, but we can't declare a type
   * with PASS_STYLE from JSDoc.
   *
   * @type {{ [PASS_STYLE]: string,
   *          [Symbol.toStringTag]: string,
   *          toString: () => void
   *        }}
   */
  const proto = getPrototypeOf(original);
  if (
    !(
      check(
        typeof proto === 'object',
        X`cannot serialize non-objects like ${proto}`,
      ) &&
      check(!Array.isArray(proto), X`Arrays cannot be pass-by-remote`) &&
      check(proto !== null, X`null cannot be pass-by-remote`) &&
      check(
        // Since we're working with TypeScript's unsound type system, mostly
        // to catch accidents and to provide IDE support, we type arguments
        // like `val` according to what they are supposed to be. The following
        // tests for a particular violation. However, TypeScript complains
        // because *if the declared type were accurate*, then the condition
        // would always return true.
        // @ts-ignore TypeScript assumes what we're trying to check
        proto !== Object.prototype,
        X`Remotables must now be explicitly declared: ${q(original)}`,
      )
    )
  ) {
    return false;
  }

  const protoProto = getPrototypeOf(proto);

  if (typeof original === 'object') {
    if (
      !(
        check(
          protoProto === objectPrototype || protoProto === null,
          X`The Remotable Proto marker cannot inherit from anything unusual`,
        ) && check(isFrozen(proto), X`The Remotable proto must be frozen`)
      )
    ) {
      return false;
    }
  } else if (typeof original === 'function') {
    if (
      !(
        check(
          protoProto === functionPrototype,
          X`For far functions, the Remotable Proto marker must inherit from Function.prototype, in ${original}`,
        ) && check(isFrozen(proto), X`The Remotable proto must be frozen`)
      )
    ) {
      return false;
    }
  } else {
    assert.fail(X`unrecognized typeof ${original}`);
  }

  const {
    [PASS_STYLE]: passStyleDesc,
    toString: toStringDesc,
    // @ts-ignore https://github.com/microsoft/TypeScript/issues/1863
    [Symbol.toStringTag]: ifaceDesc,
    ...rest
  } = getOwnPropertyDescriptors(proto);

  return (
    check(
      ownKeys(rest).length === 0,
      X`Unexpected properties on Remotable Proto ${ownKeys(rest)}`,
    ) &&
    check(!!passStyleDesc, X`Remotable must have a [PASS_STYLE]`) &&
    check(
      passStyleDesc.value === 'remotable',
      X`Expected 'remotable', not ${q(passStyleDesc.value)}`,
    ) &&
    check(
      typeof toStringDesc.value === 'function',
      X`toString must be a function`,
    ) &&
    checkIface(ifaceDesc && ifaceDesc.value, check)
  );
};

/**
 * Ensure that val could become a legitimate remotable.  This is used internally
 * both in the construction of a new remotable and checkRemotable.
 *
 * @param {*} val The remotable candidate to check
 * @param {Checker} [check]
 * @returns {boolean}
 */
function checkCanBeRemotable(val, check = x => x) {
  if (
    !(
      check(
        typeof val === 'object' || typeof val === 'function',
        X`cannot serialize non-objects like ${val}`,
      ) &&
      check(!Array.isArray(val), X`Arrays cannot be pass-by-remote`) &&
      check(val !== null, X`null cannot be pass-by-remote`)
    )
  ) {
    return false;
  }

  const descs = getOwnPropertyDescriptors(val);
  if (typeof val === 'object') {
    const keys = ownKeys(descs); // enumerable-and-not, string-or-Symbol
    return keys.every(
      key =>
        // Typecast needed due to https://github.com/microsoft/TypeScript/issues/1863
        check(
          !('get' in descs[/** @type {string} */ (key)]),
          X`cannot serialize Remotables with accessors like ${q(
            String(key),
          )} in ${val}`,
        ) &&
        check(
          typeof val[key] === 'function',
          X`cannot serialize Remotables with non-methods like ${q(
            String(key),
          )} in ${val}`,
        ) &&
        check(
          key !== PASS_STYLE,
          X`A pass-by-remote cannot shadow ${q(PASS_STYLE)}`,
        ),
    );
  } else if (typeof val === 'function') {
    // Far functions cannot be methods, and cannot have methods.
    // They must have exactly expected `.name` and `.length` properties
    const { name: nameDesc, length: lengthDesc, ...restDescs } = descs;
    const restKeys = ownKeys(restDescs);
    return (
      check(
        nameDesc && typeof nameDesc.value === 'string',
        X`Far function name must be a string, in ${val}`,
      ) &&
      check(
        lengthDesc && typeof lengthDesc.value === 'number',
        X`Far function length must be a number, in ${val}`,
      ) &&
      check(
        restKeys.length === 0,
        X`Far functions unexpected properties besides .name and .length ${restKeys}`,
      )
    );
  } else {
    assert.fail(X`unrecognized typeof ${val}`);
  }
}

const canBeRemotable = val => checkCanBeRemotable(val);
harden(canBeRemotable);
export { canBeRemotable };

const assertCanBeRemotable = val => {
  checkCanBeRemotable(val, assertChecker);
};
harden(assertCanBeRemotable);
export { assertCanBeRemotable };

/**
 * @param {Remotable} val
 * @param {Checker} [check]
 * @returns {boolean}
 */
function checkRemotable(val, check = x => x) {
  const not = (cond, details) => !check(cond, details);
  if (not(isFrozen(val), X`cannot serialize non-frozen objects like ${val}`)) {
    return false;
  }
  if (!checkCanBeRemotable(val, check)) {
    return false;
  }
  const p = getPrototypeOf(val);

  if (ALLOW_IMPLICIT_REMOTABLES && (p === null || p === objectPrototype)) {
    const err = assert.error(
      X`Remotables should be explicitly declared: ${q(val)}`,
    );
    console.warn('Missing Far:', err);
    return true;
  }
  return checkRemotableProtoOf(val, check);
}

/**
 * @param {Remotable} val
 */
const assertRemotable = val => {
  checkRemotable(val, assertChecker);
};

/** @type {MarshalGetInterfaceOf} */
const getInterfaceOf = val => {
  if (
    typeof val !== 'object' ||
    val === null ||
    val[PASS_STYLE] !== 'remotable' ||
    !checkRemotable(val)
  ) {
    return undefined;
  }
  return val[Symbol.toStringTag];
};
harden(getInterfaceOf);
export { getInterfaceOf };

/**
 * objects can only be passed in one of two forms:
 * 1: pass-by-remote: all properties (own and inherited) are methods,
 *    the object itself is of type object, not function
 * 2: pass-by-copy: all string-named own properties are data, not methods
 *    the object must inherit from objectPrototype or null
 *
 * all objects must be frozen
 *
 * anything else will throw an error if you try to serialize it
 * with these restrictions, our remote call/copy protocols expose all useful
 * behavior of these objects: pass-by-remote objects have no other data (so
 * there's nothing else to copy), and pass-by-copy objects have no other
 * behavior (so there's nothing else to invoke)
 *
 * How would val be passed?  For primitive values, the answer is
 *   * 'null' for null
 *   * throwing an error for a symbol, whether registered or not.
 *   * that value's typeof string for all other primitive values
 * For frozen objects, the possible answers
 *   * 'copyRecord' for non-empty records with only data properties
 *   * 'copyArray' for arrays with only data properties
 *   * 'copyError' for instances of Error with only data properties
 *   * 'remotable' for non-array objects with only method properties
 *   * 'promise' for genuine promises only
 *   * throwing an error on anything else, including thenables.
 * We export passStyleOf so other algorithms can use this module's
 * classification.
 *
 * @param {Passable} val
 * @returns {PassStyle}
 */
export function passStyleOf(val) {
  const typestr = typeof val;
  switch (typestr) {
    case 'object': {
      if (getInterfaceOf(val)) {
        return 'remotable';
      }
      if (val === null) {
        return 'null';
      }
      assert(
        isFrozen(val),
        X`Cannot pass non-frozen objects like ${val}. Use harden()`,
      );
      if (isPromise(val)) {
        return 'promise';
      }
      assert(
        typeof val.then !== 'function',
        X`Cannot pass non-promise thenables`,
      );
      if (isPassByCopyError(val)) {
        return 'copyError';
      }
      if (isPassByCopyArray(val)) {
        return 'copyArray';
      }
      if (isPassByCopyRecord(val)) {
        return 'copyRecord';
      }
      assertRemotable(val);
      return 'remotable';
    }
    case 'function': {
      if (getInterfaceOf(val)) {
        return 'remotable';
      }
      assert(
        isFrozen(val),
        X`Cannot pass non-frozen objects like ${val}. Use harden()`,
      );
      assertRemotable(val);
      return 'remotable';
    }
    case 'undefined':
    case 'string':
    case 'boolean':
    case 'number':
    case 'bigint':
    case 'symbol': {
      return typestr;
    }
    default: {
      assert.fail(X`Unrecognized typeof ${q(typestr)}`, TypeError);
    }
  }
}
