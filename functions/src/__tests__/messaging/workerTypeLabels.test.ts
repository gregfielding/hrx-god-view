import { expect } from 'chai';
import { workerTypeLabelForEntityKey } from '../../messaging/workerTypeLabels';

describe('workerTypeLabelForEntityKey', () => {
  it('maps select to on-call W employee in English', () => {
    expect(workerTypeLabelForEntityKey('select', 'en')).to.equal('On-Call Employee');
  });

  it('maps workforce to on-call W employee in Spanish', () => {
    expect(workerTypeLabelForEntityKey('workforce', 'es')).to.equal(
      'Empleado(a) por Llamada (W-2)',
    );
  });

  it('maps events to independent contractor in English', () => {
    expect(workerTypeLabelForEntityKey('events', 'en')).to.equal('Independent Contractor');
  });

  it('maps events to independent contractor in Spanish', () => {
    expect(workerTypeLabelForEntityKey('events', 'es')).to.equal(
      'Contratista Independiente (1099)',
    );
  });
});
