import request from 'supertest';
import { app } from './index';

/**
 * Tests for the anonymous behavior-analytics endpoint. Telemetry is a no-op
 * under NODE_ENV=test, so these assert the validation/routing contract: the
 * endpoint always answers 204 and never throws, regardless of input.
 */
describe('POST /events', () => {
  it('accepts a valid event and returns 204', async () => {
    await request(app)
      .post('/events')
      .send({ event: 'view_changed', props: { view: 'stages' } })
      .expect(204);
  });

  it('accepts a valid division_selected event', async () => {
    await request(app)
      .post('/events')
      .send({ event: 'division_selected', props: { division: 'hg18' } })
      .expect(204);
  });

  it('accepts events carrying a numeric magnitude', async () => {
    await request(app)
      .post('/events')
      .send({ event: 'comparison_changed', props: { size: 3 } })
      .expect(204);
    await request(app)
      .post('/events')
      .send({ event: 'stages_excluded', props: { count: 2 } })
      .expect(204);
  });

  it('returns 204 (not an error) for an unknown event', async () => {
    await request(app)
      .post('/events')
      .send({ event: 'definitely_not_real', props: { foo: 'bar' } })
      .expect(204);
  });

  it('returns 204 for a malformed / empty body', async () => {
    await request(app).post('/events').send({}).expect(204);
    await request(app).post('/events').send({ event: 123 }).expect(204);
  });

  it('tolerates unknown/oversized prop values without throwing', async () => {
    await request(app)
      .post('/events')
      .send({ event: 'division_selected', props: { division: 'not-a-division' } })
      .expect(204);
    await request(app)
      .post('/events')
      .send({ event: 'stages_excluded', props: { count: 999999 } })
      .expect(204);
  });
});
