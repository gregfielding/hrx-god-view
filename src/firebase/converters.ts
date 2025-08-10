import { Company, CompanySchema, Contact, ContactSchema, Deal, DealSchema, Task, TaskSchema, cleanForWrite } from '../schemas/crm';

type FirestoreData = Record<string, unknown>;

function makeConverter<T>(schema: any) {
  return {
    toFirestore(data: T): FirestoreData {
      return cleanForWrite(data as unknown as FirestoreData);
    },
    fromFirestore(snapshot: any, options: any): T {
      const raw = snapshot.data(options);
      const parsed = schema.parse({ id: snapshot.id, ...raw });
      return parsed as T;
    }
  };
}

export const companyConverter = makeConverter<Company>(CompanySchema);
export const contactConverter = makeConverter<Contact>(ContactSchema);
export const dealConverter = makeConverter<Deal>(DealSchema);
export const taskConverter = makeConverter<Task>(TaskSchema);


