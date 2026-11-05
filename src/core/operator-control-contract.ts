// Browser-safe control identifiers shared by the API and operator UI.
export const OPERATOR_CONTROL_KEYS = [
    'messagesEnabled', 'commandsEnabled', 'greetingsEnabled', 'farewellsEnabled',
    'followsEnabled', 'giftsEnabled', 'paypiggiesEnabled', 'raidsEnabled',
    'sharesEnabled', 'repostsEnabled'
] as const;

export type OperatorControlKey = (typeof OPERATOR_CONTROL_KEYS)[number];
export type OperatorControls = Record<OperatorControlKey, boolean>;
export type OperatorConfigState = 'on' | 'off' | 'mixed';
