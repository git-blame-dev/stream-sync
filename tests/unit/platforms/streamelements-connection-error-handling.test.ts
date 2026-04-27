import { describe, it, expect, afterEach } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createStreamElementsConfigFixture } from "../../helpers/config-fixture";
import { StreamElementsPlatform } from "../../../src/platforms/streamelements";

type ConnectionErrorHandlerCall = [Error, string, string?];
type RetryConnectionCall = [string, Error, () => void, () => void];

afterEach(() => {
  restoreAllMocks();
});

describe("StreamElementsPlatform connection error handling", () => {
  it("routes connection errors through error handler and retry handler", () => {
    const platform = new StreamElementsPlatform(
      createStreamElementsConfigFixture(),
      { logger: noOpLogger },
    );
    const errorHandlerCalls: ConnectionErrorHandlerCall[] = [];
    const errorHandler = {
      handleConnectionError: (...args: ConnectionErrorHandlerCall) =>
        errorHandlerCalls.push(args),
    };
    platform.errorHandler = errorHandler;
    const retryCalls: RetryConnectionCall[] = [];
    platform.retryHandleConnectionError = (...args: RetryConnectionCall) =>
      retryCalls.push(args);

    const error = new Error("connection lost");
    platform.handleConnectionError(error);

    expect(errorHandlerCalls).toHaveLength(1);
    const [errorArg, category, message] = errorHandlerCalls[0];
    expect(errorArg).toBe(error);
    expect(category).toBe("connection");
    expect(message).toMatch(/connection lost/i);

    expect(retryCalls).toHaveLength(1);
    const [platformName, retryError, reconnectFn, cleanupFn] = retryCalls[0];
    expect(platformName).toBe("StreamElements");
    expect(retryError).toBe(error);
    expect(typeof reconnectFn).toBe("function");
    expect(typeof cleanupFn).toBe("function");
  });
});
