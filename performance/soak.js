import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const SUPABASE_URL = (__ENV.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = __ENV.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

const errorRate = new Rate('soak_errors');
const homepageDuration = new Trend('soak_homepage_duration', true);
const propertiesDuration = new Trend('soak_properties_duration', true);
const apiDuration = new Trend('soak_public_api_duration', true);
const rpcDuration = new Trend('soak_rpc_duration', true);

export const options = {
  scenarios: {
    public_soak: {
      executor: 'constant-vus',
      vus: 25,
      duration: '60m',
      gracefulStop: '30s',
    },
  },

  thresholds: {
    checks: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    soak_errors: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<4000'],
    soak_homepage_duration: ['p(95)<1000'],
    soak_properties_duration: ['p(95)<1000'],
    soak_public_api_duration: ['p(95)<1000'],
    soak_rpc_duration: ['p(95)<1200'],
  },
};

function record(response, metric, checks) {
  metric.add(response.timings.duration);
  const passed = check(response, checks);
  errorRate.add(!passed);
  return passed;
}

export function setup() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  }
  return {};
}

export default function () {
  const homepage = http.get(`${BASE_URL}/`, {
    tags: { endpoint: 'soak_homepage' },
    timeout: '10s',
  });

  record(homepage, homepageDuration, {
    'Homepage status is 200': (r) => r.status === 200,
    'Homepage body exists': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(1);

  const propertiesPage = http.get(`${BASE_URL}/properties`, {
    tags: { endpoint: 'soak_properties_page' },
    timeout: '10s',
  });

  record(propertiesPage, propertiesDuration, {
    'Properties page status is 200': (r) => r.status === 200,
    'Properties page body exists': (r) => Boolean(r.body && r.body.length > 0),
  });

  sleep(1);

  const publicApi = http.get(`${BASE_URL}/api/public/properties`, {
    tags: { endpoint: 'soak_public_properties_api' },
    timeout: '10s',
  });

  record(publicApi, apiDuration, {
    'Public properties API status is 200': (r) => r.status === 200,
    'Public properties API returned JSON array': (r) => {
      try {
        return Array.isArray(r.json());
      } catch {
        return false;
      }
    },
  });

  sleep(1);

  const rpc = http.post(
    `${SUPABASE_URL}/rest/v1/rpc/get_public_properties_v2`,
    '{}',
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: 'soak_supabase_properties_rpc' },
      timeout: '10s',
    }
  );

  record(rpc, rpcDuration, {
    'Property RPC status is 200': (r) => r.status === 200,
    'Property RPC returned JSON array': (r) => {
      try {
        return Array.isArray(r.json());
      } catch {
        return false;
      }
    },
  });

  sleep(2);
}


