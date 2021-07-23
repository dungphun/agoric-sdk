/* global makeKind */
import { E } from '@agoric/eventual-send';

const things = [];

export function buildRootObject(_vatPowers) {
  function makeThingInstance(state) {
    return {
      init(label) {
        state.label = label;
      },
      self: {
        getLabel() {
          return state.label;
        },
      },
    };
  }

  const thingMaker = makeKind(makeThingInstance);
  let nextThingNumber = 0;

  return harden({
    prepare() {
      for (let i = 1; i <= 9; i += 1) {
        things.push(thingMaker(`thing #${i}`));
      }
    },
    getThing(forWhom) {
      let thing;
      do {
        thing = things[nextThingNumber];
        nextThingNumber += 1;
      } while (!thing);

      if (nextThingNumber === 2) {
        thing.getLabel();
        things[3].getLabel();
        things[3] = null; // arbitrarily drop one before sending it, but don't drop the one we're sending
      } else {
        thing.getLabel();
        things[nextThingNumber - 1] = null; // drop the one we're sending
      }
      E(forWhom).deliverThing(thing);
      thing = null;
    },
    finish() {
      while (nextThingNumber < 7) {
        const deadThing = things[nextThingNumber];
        if (deadThing) {
          deadThing.getLabel();
          things[nextThingNumber] = null;
        }
        nextThingNumber += 1;
      }
      console.log(`Bob finishing`);
    },
  });
}
