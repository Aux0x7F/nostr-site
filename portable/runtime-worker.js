export function attachSharedRuntimeWorker(host, globalScope = globalThis) {
  if (!host || typeof host !== "object") {
    throw new Error("A runtime host is required.");
  }

  const subscriptions = new WeakMap();

  function portSubscriptions(port) {
    if (!subscriptions.has(port)) {
      subscriptions.set(port, new Map());
    }
    return subscriptions.get(port);
  }

  async function handleRequest(port, message = {}) {
    if (!message || message.type !== "request") return;
    const response = {
      type: "response",
      id: message.id
    };
    try {
      response.result = await dispatchAction(port, message.action, message.payload || {});
      response.ok = true;
    } catch (error) {
      response.ok = false;
      response.error = {
        code: String(error?.code || "").trim(),
        message: String(error?.message || error || "Runtime action failed.")
      };
    }
    port.postMessage(response);
  }

  async function dispatchAction(port, action = "", payload = {}) {
    switch (String(action || "").trim()) {
      case "runtime.seedSession":
        return host.seedSession(payload.session, { force: Boolean(payload.force) });
      case "session.get":
        return host.getSession();
      case "auth.signIn":
        return host.signIn(payload);
      case "auth.signOut":
        return host.signOut(payload);
      case "auth.rotatePassword":
        return host.rotatePassword(payload);
      case "relay.publish":
        return host.publish(payload);
      case "action.call":
        return host.callAction(payload.action, payload.payload || {});
      case "projection.get":
        return host.getProjection(payload.channel, payload.params, payload.options);
      case "projection.refresh":
        return host.refreshProjection(payload.channel, payload.params, payload.options);
      case "projection.remember":
        return host.rememberProjection(payload.channel, payload.params, payload.value, payload.meta);
      case "projection.subscribe": {
        const unsubscribe = await host.subscribeProjection(
          payload.channel,
          payload.params,
          (event) => {
            port.postMessage({
              type: "projection.update",
              subscriptionId: payload.subscriptionId,
              channel: payload.channel,
              params: payload.params || {},
              envelope: event.envelope || null,
              value: event.value,
              status: event.status,
              digest: event.digest,
              updatedAt: event.updatedAt,
              meta: event.meta || {}
            });
          },
          payload.options || {}
        );
        portSubscriptions(port).set(payload.subscriptionId, unsubscribe);
        return { subscriptionId: payload.subscriptionId };
      }
      case "projection.unsubscribe": {
        const unsubscribe = portSubscriptions(port).get(payload.subscriptionId);
        unsubscribe?.();
        portSubscriptions(port).delete(payload.subscriptionId);
        return { subscriptionId: payload.subscriptionId };
      }
      case "doc.open":
        return host.openDocument(payload);
      case "doc.apply":
        return host.applyDocument(payload);
      case "doc.close":
        return host.closeDocument(payload);
      default:
        throw new Error(`Unknown runtime action: ${action}`);
    }
  }

  function attachPort(port) {
    port.start?.();
    port.addEventListener("message", (event) => {
      void handleRequest(port, event.data);
    });
    port.addEventListener("messageerror", () => {});
  }

  globalScope.onconnect = (event) => {
    for (const port of event.ports || []) {
      attachPort(port);
    }
  };

  return {
    attachPort
  };
}

export default attachSharedRuntimeWorker;
