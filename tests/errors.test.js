import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../src/errors.js';

describe('errorHandler', () => {
  it('hands the error to Express when the response has already started', () => {
    const error = new Error('failed while streaming');
    const res = {
      headersSent: true,
      status: () => assert.fail('must not set a status after headers were sent'),
    };
    let passedOn;
    errorHandler(error, {}, res, (value) => { passedOn = value; });
    assert.equal(passedOn, error);
  });
});
