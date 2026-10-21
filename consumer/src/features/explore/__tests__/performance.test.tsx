import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, expect, it, vi } from 'vitest'
import { ModelHealth, PerformanceValues } from '../ModelHealth'
import { performanceSegments, performanceValue } from '../performance'
import { PerformanceTrend } from '../PerformanceTrend'

vi.mock('@/lib/session', () => ({ useSession: () => ({ user: { id: 52 } }) }))
const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('@/lib/api', () => ({ request: api.request }))
beforeEach(() => {
  api.request.mockReset()
})
async function setup(group = 'standard') {
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrap = (group: string) => (
    <I18nextProvider i18n={language}>
      <QueryClientProvider client={client}>
        <ModelHealth model="test model" group={group} expanded />
      </QueryClientProvider>
    </I18nextProvider>
  )
  const view = render(wrap(group))
  return (group: string) => view.rerender(wrap(group))
}
it('shows group-specific metrics and drops previous group data while switching', async () => {
  api.request.mockImplementation(async () => ({
    groups: [
      {
        group: 'standard',
        success_rate: 75,
        avg_tps: 42.5,
        avg_latency_ms: 2000,
        avg_ttft_ms: 500,
        series: [{ ts: 1790000000, success_rate: 100, avg_tps: 45, avg_latency_ms: 2000 }],
      },
    ],
  }))
  const change = await setup()
  expect(
    await screen.findByText(
      (_, element) => element?.tagName === 'DD' && element.textContent === '75 %',
    ),
  ).toBeInTheDocument()
  expect(
    screen.getByText(
      (_, element) => element?.tagName === 'DD' && element.textContent === '42.5 token/s',
    ),
  ).toBeInTheDocument()
  expect(screen.getByText('Recent requests succeeded')).toBeInTheDocument()
  expect(api.request).toHaveBeenCalledWith(
    '/api/perf-metrics?model=test%20model&hours=24',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )
  change('premium')
  await screen.findByText('No recent samples')
  expect(screen.queryByText('75 %')).not.toBeInTheDocument()
  expect(screen.queryByText('0%')).not.toBeInTheDocument()
})
it('does not label an unsampled model as healthy or treat a foreign group as the selected group', async () => {
  api.request.mockResolvedValue({
    summary: { success_rate: 100, avg_tps: 999 },
    groups: [{ group: 'other', success_rate: 100, avg_tps: 999, series: [] }],
  })
  await setup()
  await screen.findByText('No recent samples')
  expect(screen.queryByText('100%')).not.toBeInTheDocument()
  expect(screen.queryByText('999 token/s')).not.toBeInTheDocument()
})
it('shows a retrieval failure distinctly and allows retry without probing the AI model', async () => {
  api.request
    .mockRejectedValueOnce(new Error('fixture unavailable'))
    .mockResolvedValue({ groups: [] })
  await setup()
  await screen.findByText('Performance unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await waitFor(() => expect(screen.getByText('No recent samples')).toBeInTheDocument())
  expect(api.request).toHaveBeenCalledTimes(2)
})

it('distinguishes observed zeros from missing metrics and exposes all four trends without filling gaps', async () => {
  api.request.mockResolvedValue({
    window_start: 1790000000,
    window_end: 1790003600,
    groups: [
      {
        group: 'standard',
        request_count: 4,
        success_count: 0,
        success_rate: 0,
        avg_ttft_ms: 0,
        ttft_sample_count: 2,
        avg_tps: 0,
        tps_observed: false,
        avg_latency_ms: 1200,
        series: [
          {
            ts: 1790000000,
            request_count: 2,
            success_rate: 0,
            avg_ttft_ms: 0,
            ttft_sample_count: 1,
            avg_latency_ms: 1400,
            avg_tps: 0,
            tps_observed: false,
          },
          {
            ts: 1790003600,
            request_count: 2,
            success_rate: 0,
            avg_ttft_ms: 0,
            ttft_sample_count: 1,
            avg_latency_ms: 1000,
            avg_tps: 0,
            tps_observed: false,
          },
        ],
      },
    ],
  })
  await setup()
  expect(
    await screen.findByText(
      (_, element) => element?.tagName === 'DD' && element.textContent === '0 %',
    ),
  ).toBeVisible()
  expect(
    screen.getByText((_, element) => element?.tagName === 'DD' && element.textContent === '0 ms'),
  ).toBeVisible()
  expect(
    screen.getByText(
      (_, element) => element?.tagName === 'DD' && element.textContent === '1.2 sec',
    ),
  ).toBeVisible()
  expect(screen.queryByText('0 token/s')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Total latency' }))
  const chart = screen.getByRole('group', { name: 'Performance trends' })
  expect(within(chart).getByRole('img')).toHaveAttribute('aria-label', 'Total latency')
  fireEvent.keyDown(chart, { key: 'Home' })
  expect(screen.getByRole('status')).toHaveTextContent('1.4 sec')
  fireEvent.keyDown(chart, { key: 'End' })
  expect(screen.getByRole('status')).toHaveTextContent('1 sec')
  fireEvent.click(screen.getByRole('button', { name: 'Token speed (TPS)' }))
  expect(screen.getByRole('status')).toHaveTextContent('Token speed (TPS): —')
  expect(
    screen.getByText(
      'Lines connect measured hourly samples. Missing hours or measurements leave gaps; lines do not establish uptime.',
    ),
  ).toBeVisible()
  fireEvent.click(screen.getByText('How these metrics are measured'))
  expect(screen.getByText(/This is not time-based uptime/)).toBeVisible()
})

it('does not query an automatic route as if it were an actual serving group', async () => {
  await setup('auto')
  expect(
    screen.getByText(
      'Automatic routing is measured under the group that actually served the request. Compare specific groups below.',
    ),
  ).toBeVisible()
  expect(api.request).not.toHaveBeenCalled()
})

it('does not turn requests with no duration measurement into zero latency', () => {
  expect(performanceValue({ request_count: 1, avg_latency_ms: 0 }, 'avg_latency_ms')).toBeNull()
})

it('selects the correct time bucket when tapping a narrow chart', async () => {
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={language}>
      <PerformanceTrend
        start={1000}
        end={5000}
        series={[
          { ts: 1700, success_rate: 70, request_count: 1 },
          { ts: 2000, success_rate: 80, request_count: 2 },
          { ts: 5000, success_rate: 90, request_count: 3 },
        ]}
      />
    </I18nextProvider>,
  )
  const plot = screen.getByRole('group', { name: 'Performance trends' })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 320,
    height: 180,
    right: 320,
    bottom: 180,
    toJSON: () => ({}),
  })
  fireEvent.pointerDown(plot, { clientX: 107, pointerType: 'touch' })
  expect(screen.getByRole('status')).toHaveTextContent('80 %')
  expect(screen.getByRole('status')).toHaveTextContent('Requests: 2')
  fireEvent.pointerMove(plot, { clientX: 315, pointerType: 'mouse' })
  expect(screen.getByRole('status')).toHaveTextContent('90 %')
  expect(screen.getByRole('status')).toHaveTextContent('Requests: 3')
})

it('connects adjacent measured hours but breaks missing buckets and unmeasured values', () => {
  const first = { ts: 0, request_count: 1, avg_ttft_ms: 0, ttft_sample_count: 1 }
  const second = { ts: 3600, request_count: 1, avg_ttft_ms: 100, ttft_sample_count: 1 }
  const gap = { ts: 10800, request_count: 1, avg_ttft_ms: 200, ttft_sample_count: 1 }
  const missing = { ts: 14400, request_count: 1, avg_ttft_ms: 0, ttft_sample_count: 0 }
  const last = { ts: 18000, request_count: 1, avg_ttft_ms: 300, ttft_sample_count: 1 }
  expect(performanceSegments([last, second, missing, gap, first], 'avg_ttft_ms')).toEqual([
    [first, second],
    [gap],
    [last],
  ])
})

it('renders a line through adjacent observations without connecting a missing hour and keeps keyboard details', async () => {
  const language = createInstance()
  await language.init({ lng: 'en', resources: { en: { translation: {} } } })
  render(
    <I18nextProvider i18n={language}>
      <PerformanceTrend
        start={0}
        end={14400}
        series={[
          { ts: 0, request_count: 1, success_rate: 50, avg_latency_ms: 60000 },
          { ts: 3600, request_count: 2, success_rate: 75, avg_latency_ms: 120000 },
          { ts: 10800, request_count: 3, success_rate: 100, avg_latency_ms: 3600000 },
          { ts: 14400, request_count: 4, success_rate: 90, avg_latency_ms: 1800000 },
        ]}
      />
    </I18nextProvider>,
  )
  const chart = screen.getByRole('group', { name: 'Performance trends' })
  const lines = within(chart).getByRole('img').querySelectorAll('polyline')
  expect(lines).toHaveLength(2)
  expect(
    [...lines].map((line) =>
      line
        .getAttribute('points')!
        .split(' ')
        .map((point) => Number(point.split(',')[0])),
    ),
  ).toEqual([
    [0, 25],
    [75, 100],
  ])
  fireEvent.click(screen.getByRole('button', { name: 'Total latency' }))
  expect(within(chart).getByText('1 hr')).toBeVisible()
  vi.spyOn(chart, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 320,
    height: 200,
    right: 320,
    bottom: 200,
    toJSON: () => ({}),
  })
  fireEvent.pointerDown(chart, { clientX: 124, pointerType: 'touch' })
  expect(screen.getByRole('status')).toHaveTextContent('Total latency: 2 min')
  fireEvent.keyDown(chart, { key: 'Home' })
  expect(screen.getByRole('status')).toHaveTextContent('Total latency: 1 min')
  fireEvent.keyDown(chart, { key: 'ArrowRight' })
  expect(screen.getByRole('status')).toHaveTextContent('Total latency: 2 min')
  fireEvent.keyDown(chart, { key: 'End' })
  expect(screen.getByRole('status')).toHaveTextContent('Total latency: 30 min')
})

it('updates summary and comparison duration units when the interface language changes', async () => {
  const language = createInstance()
  await language.init({
    lng: 'en',
    resources: { en: { translation: {} }, zh: { translation: {} } },
  })
  render(
    <I18nextProvider i18n={language}>
      <PerformanceValues
        sample={{
          request_count: 2,
          avg_ttft_ms: 1500,
          ttft_sample_count: 1,
          avg_latency_ms: 90000,
        }}
      />
    </I18nextProvider>,
  )
  expect(screen.getByText('1.5 sec')).toBeVisible()
  expect(screen.getByText('1.5 min')).toBeVisible()
  await act(() => language.changeLanguage('zh'))
  expect(screen.getByText('1.5秒')).toBeVisible()
  expect(screen.getByText('1.5分钟')).toBeVisible()
  expect(screen.queryByText('1.5 sec')).not.toBeInTheDocument()
})
