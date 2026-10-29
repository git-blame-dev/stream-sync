import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { createRequire } from "node:module";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { DependencyFactory } from "../../src/utils/dependency-factory";
import { PlatformConnectionFactory } from "../../src/utils/platform-connection-factory";
import { validateConnectionFactoryInterface } from "../../src/utils/dependency-validator";
import { ConnectionStateManager } from "../../src/utils/connection-state-manager";

const load = createRequire(import.meta.url);

describe("Dependency Injection Validation", () => {
  const dependencyFactory = new DependencyFactory();
  const logger = dependencyFactory.createValidatedLogger("dependency-validation");
  let youtubeDependencies: ReturnType<DependencyFactory["createYoutubeDependencies"]>;
  beforeEach(() => {
    youtubeDependencies = dependencyFactory.createYoutubeDependencies({ username: "synthetic-channel" }, {
      config: { general: { ignoreSelfMessages: false } },
    });
  });
  afterEach(async () => {
    try { await youtubeDependencies.innertubeService.dispose(); }
    finally { restoreAllMocks(); }
  });

  describe("Logger Interface Contract Validation", () => {
    it("should validate logger has required interface methods before platform initialization", () => {
      const incompleteLogger = {
        info: createMockFn(),
      };

      const createPlatform = () => {
        const { ConnectionStateManager } = load(
          "../../src/utils/connection-state-manager",
        );
        const manager = new ConnectionStateManager("youtube", null);
        manager.initialize({}, { logger: incompleteLogger });
      };

      expect(createPlatform).toThrow();
      expect(createPlatform).toThrow(
        /logger.*interface.*missing.*debug.*error.*warn/i,
      );
    });

    it("should validate logger methods are callable functions", () => {
      const invalidLogger = {
        info: createMockFn(),
        debug: "not-a-function",
        error: null,
        warn: undefined,
      };

      const initializeWithInvalidLogger = () => {
        const { ConnectionStateManager } = load(
          "../../src/utils/connection-state-manager",
        );
        const manager = new ConnectionStateManager("youtube", null);
        manager.initialize({}, { logger: invalidLogger });
      };

      expect(initializeWithInvalidLogger).toThrow();
      expect(initializeWithInvalidLogger).toThrow(
        /Logger interface missing required methods.*debug.*error.*warn/i,
      );
    });

    it("should accept valid logger interface and proceed with initialization", () => {
      const validLogger = logger;

      const initializeWithValidLogger = () => {
        const { ConnectionStateManager } = load(
          "../../src/utils/connection-state-manager",
        );
        const manager = new ConnectionStateManager("youtube", null);
        manager.initialize({}, { logger: validLogger });
        return manager;
      };

      expect(initializeWithValidLogger).not.toThrow();
      const manager = initializeWithValidLogger();
      expect(manager.logger).toBe(validLogger);
    });
  });

  describe("YouTube Platform Dependency Validation", () => {
    it("should validate all required dependencies before platform initialization", () => {
      const incompleteDependencies = {
        someOtherDep: {},
      };

      const createYouTubePlatform = () => {
        const config = { youtube: { enabled: true, username: "test-user" } };
        const { YouTubePlatform } = load("../../src/platforms/youtube");
        return new YouTubePlatform(config, incompleteDependencies);
      };

      expect(createYouTubePlatform).toThrow();
      expect(createYouTubePlatform).toThrow(
        /missing.*required.*dependencies.*logger/i,
      );
    });

    it("should provide helpful guidance when dependency validation fails", () => {
      const nullDependencies = null;

      const createPlatformWithNullDeps = () => {
        const config = { youtube: { enabled: true, username: "test-user" } };
        const { YouTubePlatform } = load("../../src/platforms/youtube");
        return new YouTubePlatform(config, nullDependencies);
      };

      expect(createPlatformWithNullDeps).toThrow();
      expect(createPlatformWithNullDeps).toThrow(
        /missing required dependencies: logger/i,
      );
    });

    it("should validate dependency types and interfaces match expected contracts", () => {
      const invalidTypeDependencies = {
        ...youtubeDependencies,
        logger: "string-instead-of-object",
      };

      const createPlatformWithInvalidTypes = () => {
        const config = { youtube: { enabled: true, username: "test-user" } };
        const { YouTubePlatform } = load("../../src/platforms/youtube");
        return new YouTubePlatform(config, invalidTypeDependencies);
      };

      expect(createPlatformWithInvalidTypes).toThrow();
      expect(createPlatformWithInvalidTypes).toThrow(
        /logger.*expected.*object.*received.*string/i,
      );
    });
  });

  describe("ConnectionStateManager Dependency Validation", () => {
    it("should fail fast when initialized without required dependencies", () => {
      const manager = new (load(
        "../../src/utils/connection-state-manager",
      ).ConnectionStateManager)("youtube", null);

      const initializeWithoutDeps = () => {
        manager.initialize({}, {});
      };

      expect(initializeWithoutDeps).toThrow();
      expect(initializeWithoutDeps).toThrow(
        /initialization.*failed.*missing.*required.*dependencies/i,
      );
    });

    it("should validate connection factory interface before proceeding", () => {
      const invalidFactory = { someOtherMethod: true };

      const createManagerWithInvalidFactory = () => {
        const { ConnectionStateManager } = load(
          "../../src/utils/connection-state-manager",
        );
        return new ConnectionStateManager("youtube", invalidFactory);
      };

      expect(createManagerWithInvalidFactory).toThrow();
      expect(createManagerWithInvalidFactory).toThrow(
        /factory.*missing.*createConnection.*method/i,
      );
    });

    it("should reject null connection DTOs and reuse a real factory connection", async () => {
      const factory = new PlatformConnectionFactory(logger);
      validateConnectionFactoryInterface(factory);
      const manager = new ConnectionStateManager("youtube", factory);
      try {
        expect(manager.isConnectionValid(null)).toBe(false);
        expect(manager.isConnectionValid(undefined)).toBe(false);
        expect(manager.isConnectionValid({ connect: "invalid" })).toBe(false);
        expect(() => manager.ensureConnection()).toThrow("not properly initialized");
        manager.initialize({ username: "synthetic-channel" }, youtubeDependencies);
        const connection = manager.ensureConnection();
        expect(manager.isConnectionValid(connection)).toBe(true);
        expect(manager.ensureConnection()).toBe(connection);
        expect(manager.isConnected()).toBe(false);
        await connection.connect();
        manager.markConnected();
        expect(manager.isConnected()).toBe(true);
      } finally { manager.cleanup(); }
      expect(manager.getConnection()).toBeNull();
      expect(manager.isConnected()).toBe(false);
    });

    it("should preserve actual factory failures in manager error state", () => {
      const factory = new PlatformConnectionFactory(logger);
      validateConnectionFactoryInterface(factory);
      const manager = new ConnectionStateManager("twitch", factory);
      try {
        manager.initialize({}, { logger });
        expect(() => manager.ensureConnection()).toThrow("Twitch connection creation not yet implemented");
        expect(manager.getState()).toBe("error");
        expect(manager.lastError).toBeInstanceOf(Error);
        expect((manager.lastError as Error).message).toBe("Twitch connection creation not yet implemented");
        expect(manager.getConnection()).toBeNull();
      } finally { manager.cleanup(); }
    });
  });

  describe("Platform Factory Dependency Validation", () => {
    it("should validate factory dependencies before creating platform instances", () => {
      const createPlatformViaFactory = () => {
        const { PlatformConnectionFactory } = load(
          "../../src/utils/platform-connection-factory",
        );
        new PlatformConnectionFactory();
      };

      expect(createPlatformViaFactory).toThrow();
      expect(createPlatformViaFactory).toThrow(
        /logger dependency is required/i,
      );
    });

    it("should ensure factory creates consistent dependency interfaces", () => {
      const factory = new (load(
        "../../src/utils/platform-connection-factory",
      ).PlatformConnectionFactory)(logger);

      const createYouTubeDeps = () => {
        return factory.createStandardDependencies("youtube", logger);
      };

      expect(createYouTubeDeps).not.toThrow();
      const deps = createYouTubeDeps();
      expect(deps).toHaveProperty("logger");
      expect(deps.logger).toHaveProperty("info");
      expect(deps.logger).toHaveProperty("debug");
      expect(deps.logger).toHaveProperty("error");
      expect(deps.logger).toHaveProperty("warn");
    });
  });

  describe("Error Message Quality for Dependency Issues", () => {
    it("should provide actionable error messages for missing logger methods", () => {
      const partialLogger = {
        info: createMockFn(),
        error: createMockFn(),
      };

      const validateLogger = () => {
        const { validateLoggerInterface } = load(
          "../../src/utils/dependency-validator",
        );
        validateLoggerInterface(partialLogger);
      };

      expect(validateLogger).toThrow();
      expect(validateLogger).toThrow(/please.*add.*methods.*debug.*warn/i);
    });

    it("should suggest fixes when dependencies are completely missing", () => {
      const initializeWithoutDeps = () => {
        const config = { youtube: { enabled: true, username: "test-user" } };
        const { YouTubePlatform } = load("../../src/platforms/youtube");
        return new YouTubePlatform(config, undefined);
      };

      expect(initializeWithoutDeps).toThrow();
      expect(initializeWithoutDeps).toThrow(
        /missing required dependencies: logger/i,
      );
    });

    it("should help users understand dependency injection patterns", () => {
      const attemptIncorrectInjection = () => {
        const config = { youtube: { enabled: true, username: "test-user" } };
        const { YouTubePlatform } = load("../../src/platforms/youtube");
        return new YouTubePlatform(config, "invalid_dependencies_string");
      };

      expect(attemptIncorrectInjection).toThrow();
      expect(attemptIncorrectInjection).toThrow(
        /dependencies.*should.*be.*single.*object.*with.*logger.*property/i,
      );
    });
  });

});
