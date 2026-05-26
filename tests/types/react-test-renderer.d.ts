declare module 'react-test-renderer' {
    namespace TestRenderer {
        interface TestRendererOptions {
            createNodeMock?: (element: unknown) => unknown;
        }

        interface ReactTestInstance {
            readonly type: unknown;
            readonly props: Record<string, unknown>;
            readonly children: readonly unknown[];
            findAll(predicate: (node: ReactTestInstance) => boolean): ReactTestInstance[];
            findByType(type: unknown): ReactTestInstance;
        }

        interface ReactTestRenderer {
            readonly root: ReactTestInstance;
            toJSON(): unknown;
            unmount(): void;
            update(element: unknown): void;
        }

        function act(callback: () => void | Promise<void>): Promise<void>;
        function create(element: unknown, options?: TestRendererOptions): ReactTestRenderer;
    }

    export = TestRenderer;
}
