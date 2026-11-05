export function selfBootstrapEnabled(): boolean;
export function hostExecutionEnabled(): boolean;
export function remoteSandboxAllowed(configuration: Readonly<Record<string, string | undefined>>): boolean;
