/**
 * Typed connector interfaces — NO fake data. Every external source (CRM, email,
 * market data, file ingestion, …) sits behind a `Connector`. The template ships
 * the interface + an Unconfigured stub + a registry; the build agent registers
 * the app's real connectors. Until one is configured, screens show an empty
 * state that explains how to connect it (see `describeSetup`).
 */
export interface Connector {
  readonly id: string;
  readonly label: string;
  /** True once real credentials/config are present. */
  isConfigured(): boolean;
  /** Human-readable guidance shown in the empty state when not configured. */
  describeSetup(): string;
}

/** Default stub for an unconfigured source. Reports not-configured + setup help. */
export class UnconfiguredConnector implements Connector {
  constructor(
    public readonly id: string,
    public readonly label: string,
    private readonly setup: string,
  ) {}
  isConfigured(): boolean { return false; }
  describeSetup(): string { return this.setup; }
}

export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: string): Connector | null {
    return this.connectors.get(id) ?? null;
  }

  /** Summary for the /api/connectors endpoint + empty states. */
  list(): Array<{ id: string; label: string; configured: boolean; setup: string }> {
    return [...this.connectors.values()].map((c) => ({
      id: c.id,
      label: c.label,
      configured: c.isConfigured(),
      setup: c.describeSetup(),
    }));
  }
}
