import harden from '@agoric/harden';

export const makeContract = zoe => {
  const invite = zoe.makeInvitation(() => {}, 'tester');
  return harden({
    invite,
    publicAPI: {
      doTest: () => {
        new Array(1e7).map(Object.create);
      },
    },
  });
};
