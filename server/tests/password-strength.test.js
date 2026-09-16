'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { validateStrongPassword, assessPassword, MIN_LENGTH } = require('../src/utils/password');

describe('Força de senha', () => {
  it('piso mínimo é 6 caracteres', () => {
    assert.equal(MIN_LENGTH, 6);
  });

  it('rejeita senha curta', () => {
    const err = validateStrongPassword('Ab1');
    assert.ok(err);
    assert.match(err, /6 caracteres/i);
    assert.equal(assessPassword('Ab1').id, 'weak');
    assert.equal(assessPassword('Ab1').acceptable, false);
  });

  it('aceita 1649Ma como média (sem sequência e com letras/números)', () => {
    const value = '1649Ma';
    assert.equal(validateStrongPassword(value), null);
    const result = assessPassword(value);
    assert.equal(result.id, 'medium');
    assert.equal(result.acceptable, true);
  });

  it('rejeita 3 ou mais dígitos em sequência', () => {
    const err = validateStrongPassword('1234Ma');
    assert.ok(err);
    assert.match(err, /sequência/i);
    assert.equal(assessPassword('1234Ma').acceptable, false);
  });

  it('rejeita senha só numérica', () => {
    const err = validateStrongPassword('164925');
    assert.ok(err);
    assert.equal(assessPassword('164925').id, 'weak');
  });

  it('classifica letras + números + especial como forte', () => {
    const result = assessPassword('1649Ma!');
    assert.equal(validateStrongPassword('1649Ma!'), null);
    assert.equal(result.id, 'strong');
    assert.equal(result.acceptable, true);
  });

  it('classifica senha longa com especial como muito forte', () => {
    const result = assessPassword('1649Ma!kQpxZ');
    assert.equal(result.id, 'very_strong');
    assert.equal(result.acceptable, true);
  });

  it('rejeita senha comum da lista', () => {
    const err = validateStrongPassword('empresa123');
    assert.ok(err);
    assert.equal(assessPassword('empresa123').acceptable, false);
  });
});
