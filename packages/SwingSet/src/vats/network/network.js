// @ts-check
import makeStore from '@agoric/store';
import rawHarden from '@agoric/harden';
import { E as defaultE } from '@agoric/eventual-send';
import { producePromise } from '@agoric/produce-promise';
import { toBytes } from './bytes';

const harden = /** @type {<T>(x: T) => T} */ (rawHarden);

/**
 * Compatibility note: this must match what our peers use,
 * so don't change it casually.
 */
export const ENDPOINT_SEPARATOR = '/';

/**
 * @template T,U
 * @typedef {import('@agoric/store').Store<T,U>} Store
 */

/**
 * @template T,U
 * @typedef {import('@agoric/produce-promise').PromiseRecord<T, U>} PromiseRecord
 */

/**
 * @typedef {import('./bytes').Bytes} Bytes
 * @typedef {import('./bytes').Data} Data
 */

/**
 * @typedef {string} Endpoint A local or remote address
 * See multiaddr.js for an opinionated router implementation
 */

/**
 * @typedef {Object} Protocol The network Protocol
 * @property {(prefix: Endpoint) => Promise<Port>} bind Claim a port, or if ending in ENDPOINT_SEPARATOR, a fresh name
 */

/**
 * @typedef {Object} Port A port that has been bound to a protocol
 * @property {() => Endpoint} getLocalAddress Get the locally bound name of this port
 * @property {(acceptHandler: ListenHandler) => Promise<void>} addListener Begin accepting incoming connections
 * @property {(remote: Endpoint, connectionHandler: ConnectionHandler = {}) => Promise<Connection>} connect Make an outbound connection
 * @property {(acceptHandler: ListenHandler) => Promise<void>} removeListener Remove the currently-bound listener
 * @property {() => void} revoke Deallocate the port entirely, removing all listeners and closing all active connections
 */

/**
 * @typedef {Object} ListenHandler A handler for incoming connections
 * @property {(port: Port, l: ListenHandler) => Promise<void>} [onListen] The listener has been registered
 * @property {(port: Port, localAddr: Endpoint, remoteAddr: Endpoint, l: ListenHandler) => Promise<ConnectionHandler>} onAccept A new connection is incoming
 * @property {(port: Port, rej: any, l: ListenHandler) => Promise<void>} [onError] There was an error while listening
 * @property {(port: Port, l: ListenHandler) => Promise<void>} [onRemove] The listener has been removed
 */

/**
 * @typedef {Object} Connection
 * @property {(packetBytes: Data) => Promise<Bytes>} send Send a packet on the connection
 * @property {() => void} close Close both ends of the connection
 * @property {() => Endpoint} getLocalAddress Get the locally bound name of this connection
 * @property {() => Endpoint} getRemoteAddress Get the name of the counterparty
 */

/**
 * @typedef {Object} ConnectionHandler A handler for a given Connection
 * @property {(connection: Connection, c: ConnectionHandler) => void} [onOpen] The connection has been opened
 * @property {(connection: Connection, packetBytes: Bytes, c: ConnectionHandler) => Promise<Data>} [onReceive] The connection received a packet
 * @property {(connection: Connection, reason?: CloseReason, c: ConnectionHandler) => Promise<void>} [onClose] The connection has been closed
 *
 * @typedef {any?} CloseReason The reason a connection was closed
 */

/**
 * @typedef {Object} ProtocolHandler A handler for things the protocol implementation will invoke
 * @property {(protocol: ProtocolImpl, p: ProtocolHandler) => Promise<void>} onCreate This protocol is created
 * @property {(localAddr: Endpoint, p: ProtocolHandler) => Promise<string>} generatePortID Create a fresh port identifier for this protocol
 * @property {(port: Port, localAddr: Endpoint, p: ProtocolHandler) => Promise<void>} onBind A port will be bound
 * @property {(port: Port, localAddr: Endpoint, listenHandler: ListenHandler, p: ProtocolHandler) => Promise<void>} onListen A port was listening
 * @property {(port: Port, localAddr: Endpoint, listenHandler: ListenHandler, p: ProtocolHandler) => Promise<void>} onListenRemove A port listener has been reset
 * @property {(port: Port, localAddr: Endpoint, remote: Endpoint, c: ConnectionHandler, p: ProtocolHandler) => Promise<ConnectionHandler|undefined>} onConnect A port initiates an outbound connection
 * @property {(port: Port, localAddr: Endpoint, p: ProtocolHandler) => Promise<void>} onRevoke The port is being completely destroyed
 *
 * @typedef {Object} ProtocolImpl Things the protocol can do for us
 * @property {(listenSearch: Endpoint[]) => Promise<boolean>} isListening Tell whether anything in listenSearch is listening
 * @property {(listenSearch: Endpoint[], localAddr: Endpoint, remoteAddr: Endpoint, connectionHandler: ConnectionHandler) => Promise<Connection>} inbound Establish a connection into this protocol
 * @property {(port: Port, remoteAddr: Endpoint, connectionHandler: ConnectionHandler) => Promise<Connection>} outbound Create an outbound connection
 */

export const rethrowUnlessMissing = err => {
  // Ugly hack rather than being able to determine if the function
  // exists.
  if (
    !(err instanceof TypeError) ||
    !err.message.match(/target\[.*\] does not exist|is not a function$/)
  ) {
    throw err;
  }
  return true;
};

/**
 * Create a handled Connection.
 *
 * @param {ConnectionHandler} handler
 * @param {Endpoint} localAddr
 * @param {Endpoint} remoteAddr
 * @param {WeakSet<Connection>} [current=new WeakSet()]
 * @param {typeof defaultE} [E=defaultE] Eventual send function
 * @returns {Connection}
 */
export const makeConnection = (
  handler,
  localAddr,
  remoteAddr,
  current = new WeakSet(),
  E = defaultE,
) => {
  let closed;
  /**
   * @type {Set<PromiseRecord<Bytes,any>>}
   */
  const pendingAcks = new Set();
  /**
   * @type {Connection}
   */
  const connection = harden({
    getLocalAddress() {
      return localAddr;
    },
    getRemoteAddress() {
      return remoteAddr;
    },
    async close() {
      if (closed) {
        throw closed;
      }
      current.delete(connection);
      closed = Error('Connection closed');
      for (const ackDeferred of [...pendingAcks.values()]) {
        pendingAcks.delete(ackDeferred);
        ackDeferred.reject(closed);
      }
      await E(handler)
        .onClose(connection, undefined, handler)
        .catch(rethrowUnlessMissing);
    },
    async send(data) {
      // console.log('send', data, local === srcHandler);
      if (closed) {
        throw closed;
      }
      const bytes = toBytes(data);
      const ackDeferred = producePromise();
      pendingAcks.add(ackDeferred);
      E(handler)
        .onReceive(connection, bytes, handler)
        .catch(err => rethrowUnlessMissing(err) || '')
        .then(
          ack => {
            pendingAcks.delete(ackDeferred);
            ackDeferred.resolve(toBytes(ack));
          },
          err => {
            pendingAcks.delete(ackDeferred);
            ackDeferred.reject(err);
          },
        );
      return ackDeferred.promise;
    },
  });

  current.add(connection);
  E(handler)
    .onOpen(connection, handler)
    .catch(rethrowUnlessMissing);
  return connection;
};

/**
 *
 * @param {ConnectionHandler} handler0
 * @param {Endpoint} addr0
 * @param {ConnectionHandler} handler1
 * @param {Endpoint} addr1
 * @param {WeakSet<Connection>} [current=new WeakSet()]
 * @param {typeof defaultE} [E=defaultE]
 * @returns {[Connection, Connection]}
 */
export function crossoverConnection(
  handler0,
  addr0,
  handler1,
  addr1,
  current = new WeakSet(),
  E = defaultE,
) {
  /**
   * @type {Connection[]}
   */
  const conns = [];
  /**
   * @type {ConnectionHandler[]}
   */
  const handlers = [handler0, handler1];
  /**
   * @type {Endpoint[]}
   */
  const addrs = [addr0, addr1];

  function makeHalfConnection(l, r) {
    let closed;
    conns[l] = harden({
      getLocalAddress() {
        return addrs[l];
      },
      getRemoteAddress() {
        return addrs[r];
      },
      async send(packetBytes) {
        if (closed) {
          throw closed;
        }
        const ack =
          /** @type {Bytes} */
          (await E(handlers[r])
            .onReceive(conns[r], toBytes(packetBytes), handlers[r])
            .catch(rethrowUnlessMissing));
        return toBytes(ack);
      },
      async close() {
        if (closed) {
          throw closed;
        }
        closed = Error('Connection closed');
        current.delete(conns[l]);
        await E(handlers[l])
          .onClose(conns[l], undefined, handlers[l])
          .catch(rethrowUnlessMissing);
      },
    });
  }

  makeHalfConnection(0, 1);
  makeHalfConnection(1, 0);

  function openHalfConnection(l) {
    current.add(conns[l]);
    E(handlers[l])
      .onOpen(conns[l], handlers[l])
      .catch(rethrowUnlessMissing);
  }

  openHalfConnection(0);
  openHalfConnection(1);

  const [conn0, conn1] = conns;
  return [conn0, conn1];
}

/**
 * Get the list of prefixes from longest to shortest.
 * @param {string} addr
 */
export function getPrefixes(addr) {
  const parts = addr.split(ENDPOINT_SEPARATOR);

  /**
   * @type {string[]}
   */
  const ret = [];
  for (let i = parts.length; i > 0; i -= 1) {
    // Try most specific match.
    const prefix = parts.slice(0, i).join(ENDPOINT_SEPARATOR);
    ret.push(prefix);
  }
  return ret;
}

/**
 * Create a protocol that has a handler.
 *
 * @param {ProtocolHandler} protocolHandler
 * @param {typeof defaultE} [E=defaultE] Eventual send function
 * @returns {Protocol} the local capability for connecting and listening
 */
export function makeNetworkProtocol(protocolHandler, E = defaultE) {
  /** @type {Store<Port, Set<Connection>>} */
  const currentConnections = makeStore('port');

  /**
   * Currently must be a single listenHandler.
   * TODO: Do something sensible with multiple handlers?
   * @type {Store<Endpoint, [Port, ListenHandler]>}
   */
  const listening = makeStore('localAddr');

  /**
   * @type {ProtocolImpl}
   */
  const protocolImpl = harden({
    async isListening(listenSearch) {
      const listener = listenSearch.find(addr => listening.has(addr));
      return !!listener;
    },
    async inbound(listenSearch, localAddr, remoteAddr, rchandler) {
      const listenAddr = listenSearch.find(addr => listening.has(addr));
      if (!listenAddr) {
        throw Error(`Connection refused to ${localAddr}`);
      }
      const [port, listener] = listening.get(listenAddr);
      const current = currentConnections.get(port);

      const lchandler =
        /** @type {ConnectionHandler} */
        (await E(listener).onAccept(port, localAddr, remoteAddr, listener));

      return crossoverConnection(
        lchandler,
        localAddr,
        rchandler,
        remoteAddr,
        current,
        E,
      )[1];
    },
    async outbound(port, remoteAddr, lchandler) {
      const localAddr =
        /** @type {string} */
        (await E(port).getLocalAddress());

      const ret = getPrefixes(remoteAddr);
      if (await protocolImpl.isListening(ret)) {
        return protocolImpl.inbound(ret, remoteAddr, localAddr, lchandler);
      }

      const rchandler =
        /** @type {ConnectionHandler} */
        (await E(protocolHandler).onConnect(
          port,
          localAddr,
          remoteAddr,
          lchandler,
          protocolHandler,
        ));

      if (!rchandler) {
        throw Error(`Cannot connect to ${remoteAddr}`);
      }

      const current = currentConnections.get(port);
      return crossoverConnection(
        lchandler,
        localAddr,
        rchandler,
        remoteAddr,
        current,
        E,
      )[0];
    },
  });

  /**
   * @type {Store<string, Port>}
   */
  const boundPorts = makeStore('localAddr');

  // Wire up the local protocol to the handler.
  E(protocolHandler).onCreate(protocolImpl, protocolHandler);

  /**
   * @param {Endpoint} localAddr
   */
  const bind = async localAddr => {
    // Check if we are underspecified (ends in slash)
    if (localAddr.endsWith(ENDPOINT_SEPARATOR)) {
      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const portID = await E(protocolHandler).generatePortID(localAddr);
        const newAddr = `${localAddr}${portID}`;
        if (!boundPorts.has(newAddr)) {
          localAddr = newAddr;
          break;
        }
      }
    }

    /**
     * @enum {number}
     */
    const RevokeState = {
      NOT_REVOKED: 0,
      REVOKING: 1,
      REVOKED: 2,
    };

    /**
     * @type {RevokeState}
     */
    let revoked = RevokeState.NOT_REVOKED;
    const openConnections = new Set();

    /**
     * @type {Port}
     */
    const port = harden({
      getLocalAddress() {
        // Works even after revoke().
        return localAddr;
      },
      async addListener(listenHandler) {
        if (revoked) {
          throw Error(`Port ${localAddr} is revoked`);
        }
        if (!listenHandler) {
          throw TypeError(`listenHandler is not defined`);
        }
        if (listening.has(localAddr)) {
          // Last one wins.
          const [lport, lhandler] = listening.get(localAddr);
          if (lhandler === listenHandler) {
            return;
          }
          listening.set(localAddr, [port, listenHandler]);
          E(lhandler)
            .onRemove(lport, lhandler)
            .catch(rethrowUnlessMissing);
        } else {
          listening.init(localAddr, [port, listenHandler]);
        }

        // TODO: Check that the listener defines onAccept.

        await E(protocolHandler).onListen(
          port,
          localAddr,
          listenHandler,
          protocolHandler,
        );
        await E(listenHandler)
          .onListen(port, listenHandler)
          .catch(rethrowUnlessMissing);
      },
      async removeListener(listenHandler) {
        if (!listening.has(localAddr)) {
          throw Error(`Port ${localAddr} is not listening`);
        }
        if (listening.get(localAddr)[1] !== listenHandler) {
          throw Error(`Port ${localAddr} handler to remove is not listening`);
        }
        listening.delete(localAddr);
        await E(protocolHandler).onListenRemove(
          port,
          localAddr,
          listenHandler,
          protocolHandler,
        );
        await E(listenHandler)
          .onRemove(port, listenHandler)
          .catch(rethrowUnlessMissing);
      },
      async connect(remotePort, connectionHandler = {}) {
        if (revoked) {
          throw Error(`Port ${localAddr} is revoked`);
        }
        /**
         * @type {Endpoint}
         */
        const dst = harden(remotePort);
        const conn = await protocolImpl.outbound(port, dst, connectionHandler);
        if (revoked) {
          E(conn).close();
        } else {
          openConnections.add(conn);
        }
        return conn;
      },
      async revoke() {
        if (revoked === RevokeState.REVOKED) {
          throw Error(`Port ${localAddr} is already revoked`);
        }
        revoked = RevokeState.REVOKING;
        await E(protocolHandler).onRevoke(port, localAddr, protocolHandler);
        revoked = RevokeState.REVOKED;

        // Clean up everything we did.
        const ps = [...currentConnections.get(port)].map(conn =>
          E(conn)
            .close()
            .catch(_ => {}),
        );
        if (listening.has(localAddr)) {
          const listener = listening.get(localAddr)[1];
          ps.push(port.removeListener(listener));
        }
        await Promise.all(ps);
        currentConnections.delete(port);
        boundPorts.delete(localAddr);
        return `Port ${localAddr} revoked`;
      },
    });

    await E(protocolHandler).onBind(port, localAddr, protocolHandler);
    boundPorts.init(localAddr, port);
    currentConnections.init(port, new Set());
    return port;
  };

  return harden({ bind });
}

/**
 * Create a ConnectionHandler that just echoes its packets.
 *
 * @returns {ConnectionHandler}
 */
export function makeEchoConnectionHandler() {
  let closed;
  /**
   * @type {Connection}
   */
  return harden({
    async onReceive(_connection, bytes, _connectionHandler) {
      if (closed) {
        throw closed;
      }
      return bytes;
    },
    async onClose(_connection, _connectionHandler) {
      if (closed) {
        throw closed;
      }
      closed = Error('Connection closed');
    },
  });
}

/**
 * Create a protocol handler that just connects to itself.
 *
 * @param {typeof defaultE} [E=defaultE] Eventual sender
 * @returns {ProtocolHandler} The localhost handler
 */
export function makeLoopbackProtocolHandler(E = defaultE) {
  /**
   * @type {Store<string, [Port, ListenHandler]>}
   */
  const listeners = makeStore('localAddr');

  let nonce = 0;

  return harden({
    // eslint-disable-next-line no-empty-function
    async onCreate(_impl, _protocolHandler) {
      // TODO
    },
    async generatePortID(_protocolHandler) {
      nonce += 1;
      return `port${nonce}`;
    },
    async onBind(_port, _localAddr, _protocolHandler) {
      // TODO: Maybe handle a bind?
    },
    async onConnect(_port, localAddr, remoteAddr, _chandler, _protocolHandler) {
      if (!listeners.has(remoteAddr)) {
        return undefined;
      }
      const [lport, lhandler] = listeners.get(remoteAddr);
      // console.log(`looking up onAccept in`, lhandler);
      const rport = await E(lhandler).onAccept(
        lport,
        remoteAddr,
        localAddr,
        lhandler,
      );
      // console.log(`rport is`, rport);
      return rport;
    },
    async onListen(port, localAddr, listenHandler, _protocolHandler) {
      // TODO: Implement other listener replacement policies.
      if (listeners.has(localAddr)) {
        const lhandler = listeners.get(localAddr)[1];
        if (lhandler !== listenHandler) {
          // Last-one-wins.
          listeners.set(localAddr, [port, listenHandler]);
        }
      } else {
        listeners.init(localAddr, [port, listenHandler]);
      }
    },
    async onListenRemove(port, localAddr, listenHandler, _protocolHandler) {
      const [lport, lhandler] = listeners.get(localAddr);
      if (lport !== port) {
        throw Error(`Port does not match listener on ${localAddr}`);
      }
      if (lhandler !== listenHandler) {
        throw Error(`Listen handler does not match listener on ${localAddr}`);
      }
      listeners.delete(localAddr);
    },
    async onRevoke(_port, _localAddr, _protocolHandler) {
      // TODO: maybe clean up?
    },
  });
}
