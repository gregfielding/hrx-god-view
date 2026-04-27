import { expect } from 'chai';
import { placeholdersMatch } from '../../translation/placeholder';

describe('translation/placeholdersMatch', () => {
  it('matches when placeholders preserved', () => {
    expect(placeholdersMatch('Hi {{firstName}}', 'Hola {{firstName}}')).to.equal(true);
  });

  it('fails when placeholders removed', () => {
    expect(placeholdersMatch('Hi {{firstName}}', 'Hola')).to.equal(false);
  });

  it('matches braces placeholders', () => {
    expect(placeholdersMatch('You have {count} items', 'Tienes {count} artículos')).to.equal(true);
  });
});
