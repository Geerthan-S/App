/**
 * Verification Source Adapter Pattern
 * Provides clean abstraction between manual verifier lookup and future official API integrations.
 */

export interface VerificationLookupQuery {
  council: string;
  registrationNumber: string;
  doctorName?: string;
  qualification?: string;
}

export interface VerificationSourceResult {
  sourceName: string;
  matched: boolean;
  officialStatus: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'NOT_FOUND' | 'SOURCE_UNAVAILABLE';
  registeredName?: string;
  registrationDate?: string;
  qualificationsRegistered?: string[];
  rawSummary: string;
  checkedAt: string;
}

export interface IVerificationSourceAdapter {
  sourceId: string;
  lookup(query: VerificationLookupQuery): Promise<VerificationSourceResult>;
}

export class ManualVerificationAdapter implements IVerificationSourceAdapter {
  public readonly sourceId = 'MANUAL_OFFICIAL_REGISTRY_LOOKUP';

  async lookup(query: VerificationLookupQuery): Promise<VerificationSourceResult> {
    // A manual review requires a real reviewer and recorded source evidence.
    // This adapter must never manufacture a successful registry check.
    void query;
    return {
      sourceName: 'Manual review pending',
      matched: false,
      officialStatus: 'SOURCE_UNAVAILABLE',
      rawSummary: 'No official registry check has been recorded by a verifier.',
      checkedAt: new Date().toISOString(),
    };
  }
}
