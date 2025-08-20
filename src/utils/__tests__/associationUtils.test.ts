import { AssociationUtils } from '../associationUtils';

describe('AssociationUtils', () => {
  const testUserId = 'user123';
  const testCompanyId = 'company456';
  const testDealId = 'deal789';
  const testContactId = 'contact101';

  describe('isCompanyAssociatedWithUser', () => {
    it('should return true for activeSalespeople match', () => {
      const company = {
        id: testCompanyId,
        activeSalespeople: { 
          [testUserId]: { 
            name: 'John Doe',
            email: 'john@example.com',
            lastActiveAt: Date.now()
          } 
        }
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });

    it('should return true for associations.salespeople string match', () => {
      const company = {
        id: testCompanyId,
        associations: { 
          salespeople: [testUserId] 
        }
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });

    it('should return true for associations.salespeople object match', () => {
      const company = {
        id: testCompanyId,
        associations: { 
          salespeople: [{ 
            id: testUserId, 
            name: 'John Doe' 
          }] 
        }
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });

    it('should return true for legacy salesOwnerId match', () => {
      const company = { 
        id: testCompanyId,
        salesOwnerId: testUserId 
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });

    it('should return true for legacy accountOwnerId match', () => {
      const company = { 
        id: testCompanyId,
        accountOwnerId: testUserId 
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });

    it('should return true for legacy associatedUsers match', () => {
      const company = { 
        id: testCompanyId,
        associatedUsers: [testUserId, 'otherUser'] 
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });

    it('should return false when no association exists', () => {
      const company = { 
        id: testCompanyId,
        name: 'Test Company' 
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(false);
    });

    it('should return false for null/undefined inputs', () => {
      expect(AssociationUtils.isCompanyAssociatedWithUser(null, testUserId)).toBe(false);
      expect(AssociationUtils.isCompanyAssociatedWithUser(undefined, testUserId)).toBe(false);
      expect(AssociationUtils.isCompanyAssociatedWithUser({}, null)).toBe(false);
      expect(AssociationUtils.isCompanyAssociatedWithUser({}, undefined)).toBe(false);
    });

    it('should prioritize activeSalespeople over other sources', () => {
      const company = {
        id: testCompanyId,
        activeSalespeople: { 
          [testUserId]: { name: 'John Doe' } 
        },
        associations: { 
          salespeople: ['differentUser'] 
        },
        salesOwnerId: 'anotherUser'
      };
      expect(AssociationUtils.isCompanyAssociatedWithUser(company, testUserId)).toBe(true);
    });
  });

  describe('isDealAssociatedWithUser', () => {
    it('should return true for associations.salespeople string match', () => {
      const deal = {
        id: testDealId,
        associations: { 
          salespeople: [testUserId] 
        }
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return true for associations.salespeople object match', () => {
      const deal = {
        id: testDealId,
        associations: { 
          salespeople: [{ 
            id: testUserId, 
            name: 'John Doe' 
          }] 
        }
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return true for legacy salesOwnerId match', () => {
      const deal = { 
        id: testDealId,
        salesOwnerId: testUserId 
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return true for legacy owner match', () => {
      const deal = { 
        id: testDealId,
        owner: testUserId 
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return true for legacy salespersonIds match', () => {
      const deal = { 
        id: testDealId,
        salespersonIds: [testUserId, 'otherUser'] 
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return true for legacy salespeopleIds match', () => {
      const deal = { 
        id: testDealId,
        salespeopleIds: [testUserId, 'otherUser'] 
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return true for legacy assignedTo match', () => {
      const deal = { 
        id: testDealId,
        assignedTo: testUserId 
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(true);
    });

    it('should return false when no association exists', () => {
      const deal = { 
        id: testDealId,
        name: 'Test Deal' 
      };
      expect(AssociationUtils.isDealAssociatedWithUser(deal, testUserId)).toBe(false);
    });

    it('should return false for null/undefined inputs', () => {
      expect(AssociationUtils.isDealAssociatedWithUser(null, testUserId)).toBe(false);
      expect(AssociationUtils.isDealAssociatedWithUser(undefined, testUserId)).toBe(false);
      expect(AssociationUtils.isDealAssociatedWithUser({}, null)).toBe(false);
      expect(AssociationUtils.isDealAssociatedWithUser({}, undefined)).toBe(false);
    });
  });

  describe('isContactAssociatedWithUser', () => {
    const myCompanyIds = [testCompanyId, 'company789'];

    it('should return true for direct salesperson association', () => {
      const contact = {
        id: testContactId,
        associations: { 
          salespeople: [testUserId] 
        }
      };
      expect(AssociationUtils.isContactAssociatedWithUser(contact, testUserId, myCompanyIds)).toBe(true);
    });

    it('should return true for company association', () => {
      const contact = {
        id: testContactId,
        associations: { 
          companies: [testCompanyId] 
        }
      };
      expect(AssociationUtils.isContactAssociatedWithUser(contact, testUserId, myCompanyIds)).toBe(true);
    });

    it('should return true for legacy companyId match', () => {
      const contact = {
        id: testContactId,
        companyId: testCompanyId
      };
      expect(AssociationUtils.isContactAssociatedWithUser(contact, testUserId, myCompanyIds)).toBe(true);
    });

    it('should return true for legacy salesOwnerId match', () => {
      const contact = {
        id: testContactId,
        salesOwnerId: testUserId
      };
      expect(AssociationUtils.isContactAssociatedWithUser(contact, testUserId, myCompanyIds)).toBe(true);
    });

    it('should return true for legacy accountOwnerId match', () => {
      const contact = {
        id: testContactId,
        accountOwnerId: testUserId
      };
      expect(AssociationUtils.isContactAssociatedWithUser(contact, testUserId, myCompanyIds)).toBe(true);
    });

    it('should return false when no association exists', () => {
      const contact = {
        id: testContactId,
        name: 'Test Contact'
      };
      expect(AssociationUtils.isContactAssociatedWithUser(contact, testUserId, myCompanyIds)).toBe(false);
    });

    it('should return false for null/undefined inputs', () => {
      expect(AssociationUtils.isContactAssociatedWithUser(null, testUserId, myCompanyIds)).toBe(false);
      expect(AssociationUtils.isContactAssociatedWithUser(undefined, testUserId, myCompanyIds)).toBe(false);
      expect(AssociationUtils.isContactAssociatedWithUser({}, null, myCompanyIds)).toBe(false);
      expect(AssociationUtils.isContactAssociatedWithUser({}, undefined, myCompanyIds)).toBe(false);
    });
  });

  describe('getUserAssociatedCompanies', () => {
    it('should return companies associated with user', () => {
      const companies = [
        { id: 'company1', activeSalespeople: { [testUserId]: { name: 'John' } } },
        { id: 'company2', associations: { salespeople: [testUserId] } },
        { id: 'company3', salesOwnerId: testUserId },
        { id: 'company4', name: 'Unassociated Company' }
      ];

      const result = AssociationUtils.getUserAssociatedCompanies(companies, testUserId);
      expect(result).toHaveLength(3);
      expect(result.map(c => c.id)).toEqual(['company1', 'company2', 'company3']);
    });

    it('should return empty array for no associations', () => {
      const companies = [
        { id: 'company1', name: 'Company 1' },
        { id: 'company2', name: 'Company 2' }
      ];

      const result = AssociationUtils.getUserAssociatedCompanies(companies, testUserId);
      expect(result).toHaveLength(0);
    });

    it('should handle null/undefined inputs', () => {
      expect(AssociationUtils.getUserAssociatedCompanies(null, testUserId)).toEqual([]);
      expect(AssociationUtils.getUserAssociatedCompanies(undefined, testUserId)).toEqual([]);
      expect(AssociationUtils.getUserAssociatedCompanies([], null)).toEqual([]);
      expect(AssociationUtils.getUserAssociatedCompanies([], undefined)).toEqual([]);
    });
  });

  describe('getUserAssociatedDeals', () => {
    it('should return deals associated with user', () => {
      const deals = [
        { id: 'deal1', associations: { salespeople: [testUserId] } },
        { id: 'deal2', salesOwnerId: testUserId },
        { id: 'deal3', owner: testUserId },
        { id: 'deal4', name: 'Unassociated Deal' }
      ];

      const result = AssociationUtils.getUserAssociatedDeals(deals, testUserId);
      expect(result).toHaveLength(3);
      expect(result.map(d => d.id)).toEqual(['deal1', 'deal2', 'deal3']);
    });

    it('should return empty array for no associations', () => {
      const deals = [
        { id: 'deal1', name: 'Deal 1' },
        { id: 'deal2', name: 'Deal 2' }
      ];

      const result = AssociationUtils.getUserAssociatedDeals(deals, testUserId);
      expect(result).toHaveLength(0);
    });
  });

  describe('getUserAssociatedContacts', () => {
    const myCompanyIds = [testCompanyId];

    it('should return contacts associated with user', () => {
      const contacts = [
        { id: 'contact1', associations: { salespeople: [testUserId] } },
        { id: 'contact2', associations: { companies: [testCompanyId] } },
        { id: 'contact3', companyId: testCompanyId },
        { id: 'contact4', salesOwnerId: testUserId },
        { id: 'contact5', name: 'Unassociated Contact' }
      ];

      const result = AssociationUtils.getUserAssociatedContacts(contacts, testUserId, myCompanyIds);
      expect(result).toHaveLength(4);
      expect(result.map(c => c.id)).toEqual(['contact1', 'contact2', 'contact3', 'contact4']);
    });

    it('should return empty array for no associations', () => {
      const contacts = [
        { id: 'contact1', name: 'Contact 1' },
        { id: 'contact2', name: 'Contact 2' }
      ];

      const result = AssociationUtils.getUserAssociatedContacts(contacts, testUserId, myCompanyIds);
      expect(result).toHaveLength(0);
    });
  });

  describe('getAssociationStatus', () => {
    it('should return correct status for company with activeSalespeople', () => {
      const company = {
        id: testCompanyId,
        activeSalespeople: { 
          [testUserId]: { name: 'John Doe' },
          'otherUser': { name: 'Jane Doe' }
        },
        activeSalespeopleUpdatedAt: new Date('2024-01-01')
      };

      const status = AssociationUtils.getAssociationStatus(company, testUserId);
      expect(status.isAssociated).toBe(true);
      expect(status.hasActiveSalespeople).toBe(true);
      expect(status.isUserActive).toBe(true);
      expect(status.associationSources).toEqual(['activeSalespeople']);
      expect(status.lastUpdated).toBe(company.activeSalespeopleUpdatedAt);
    });

    it('should return correct status for company with associations only', () => {
      const company = {
        id: testCompanyId,
        associations: { 
          salespeople: [testUserId] 
        }
      };

      const status = AssociationUtils.getAssociationStatus(company, testUserId);
      expect(status.isAssociated).toBe(true);
      expect(status.hasActiveSalespeople).toBe(false);
      expect(status.isUserActive).toBe(false);
      expect(status.associationSources).toEqual(['associations.salespeople']);
    });

    it('should return correct status for company with legacy fields only', () => {
      const company = {
        id: testCompanyId,
        salesOwnerId: testUserId
      };

      const status = AssociationUtils.getAssociationStatus(company, testUserId);
      expect(status.isAssociated).toBe(true);
      expect(status.hasActiveSalespeople).toBe(false);
      expect(status.isUserActive).toBe(false);
      expect(status.associationSources).toEqual(['salesOwnerId']);
    });

    it('should return correct status for unassociated company', () => {
      const company = {
        id: testCompanyId,
        name: 'Test Company'
      };

      const status = AssociationUtils.getAssociationStatus(company, testUserId);
      expect(status.isAssociated).toBe(false);
      expect(status.hasActiveSalespeople).toBe(false);
      expect(status.isUserActive).toBe(false);
      expect(status.associationSources).toEqual([]);
    });

    it('should handle null/undefined inputs', () => {
      const status = AssociationUtils.getAssociationStatus(null, testUserId);
      expect(status.isAssociated).toBe(false);
      expect(status.hasActiveSalespeople).toBe(false);
      expect(status.isUserActive).toBe(false);
      expect(status.associationSources).toEqual([]);
      expect(status.lastUpdated).toBeNull();
    });
  });

  describe('debugAssociation', () => {
    let consoleSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it('should log debug information in development mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      const company = {
        id: testCompanyId,
        activeSalespeople: { [testUserId]: { name: 'John' } },
        associations: { salespeople: [testUserId] }
      };

      AssociationUtils.debugAssociation(company, testUserId, 'company');

      expect(consoleSpy).toHaveBeenCalledWith(
        '🔍 Association Debug - company:',
        expect.objectContaining({
          entityId: testCompanyId,
          userId: testUserId,
          isAssociated: true,
          hasActiveSalespeople: true,
          isUserActive: true,
          associationSources: expect.arrayContaining(['activeSalespeople']),
          activeSalespeopleCount: 1,
          associationsSalespeopleCount: 1
        })
      );

      process.env.NODE_ENV = originalEnv;
    });

    it('should not log in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const company = { id: testCompanyId };
      AssociationUtils.debugAssociation(company, testUserId, 'company');

      expect(consoleSpy).not.toHaveBeenCalled();

      process.env.NODE_ENV = originalEnv;
    });
  });
});
