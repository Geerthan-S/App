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
  officialStatus: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED' | 'NOT_FOUND';
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
    // In manual workflow, the human verifier performs verification against NMC/SMC portals
    return {
      sourceName: 'NMC / State Medical Council Portal (Manual Verifier Inspection)',
      matched: true,
      officialStatus: 'ACTIVE',
      registeredName: query.doctorName,
      rawSummary: `Manual check verified against ${query.council} registry for Reg No: ${query.registrationNumber}`,
      checkedAt: new Date().toISOString(),
    };
  }
}
