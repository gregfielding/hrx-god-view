/**
 * E.7 — RTL component tests for `CsaActionQueue`.
 *
 * The hook (`useCsaActionQueueItems`) is mocked via `jest.mock` so the
 * test drives the rendering directly with synthetic items. Hook
 * integration is covered by the pure aggregator tests in
 * `src/utils/csaActionQueue/__tests__/buildCsaActionItems.e7.test.ts` —
 * mocking the live Firestore listener is brittle and not the goal here.
 *
 * Coverage:
 *   - Empty state renders when items = []
 *   - Each action type renders with the correct title / button label
 *   - Clicking "Mark complete" opens the I-9 Section 2 dialog
 *   - Clicking "Start E-Verify" navigates to the user profile with the
 *     existing R.5 employmentScrollTo=e_verify pattern + entityKey
 *   - Clicking "Open TNC flow" navigates to the same surface
 *   - Search bar filters items in-place (uses csaActionItemMatchesSearch)
 *   - My / All toggle is rendered (default = "mine" for non-HRX)
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';

import type { CsaActionItem } from '../../../types/csaActionQueue';

const mockNavigate = jest.fn();
const mockUseHook = jest.fn();

// react-router-dom v7.9.4 ships a misconfigured `package.json#main`
// (`./dist/main.js` doesn't exist — only `./dist/index.js` does), which
// jest's bundled resolver — unlike webpack's exports-aware resolver —
// can't navigate. Webpack-based runtime works fine; jest doesn't.
// Mocking the entire module with the small surface this component uses
// (`useNavigate` + `MemoryRouter` if needed) sidesteps the broken main
// resolution without touching the jest config.
jest.mock(
  'react-router-dom',
  () => {
    // require'd lazily so jest's hoist guard accepts the factory.
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const r = require('react');
    return {
      __esModule: true,
      useNavigate: () => mockNavigate,
      MemoryRouter: ({ children }: { children: unknown }) =>
        r.createElement(r.Fragment, null, children),
    };
  },
  { virtual: true },
);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { MemoryRouter } = require('react-router-dom');

jest.mock('../../../hooks/useCsaActionQueueItems', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockUseHook(...args),
}));

jest.mock('../../../contexts/AuthContext', () => ({
  __esModule: true,
  useAuth: () => ({
    user: { uid: 'csa-1' },
    securityLevel: '5',
    isHRX: false,
    activeTenant: { id: 'tenant-1' },
  }),
}));

// Defer the dialog's actual implementation — it pulls in firebase. We
// replace it with a tiny render-only spy so we can assert the modal
// opens without dragging in the real submit path.
jest.mock('../I9Section2CompleteDialog', () => ({
  __esModule: true,
  default: ({ open, item }: { open: boolean; item: CsaActionItem | null }) =>
    open && item ? (
      <div data-testid="i9-section2-dialog-stub">
        I9 dialog open for {item.workerName}
      </div>
    ) : null,
}));

// Inline import the SUT after mocks have been set up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CsaActionQueue = require('../CsaActionQueue').default as React.ComponentType<{
  tenantId: string | undefined;
}>;

function makeItem(overrides: Partial<CsaActionItem> = {}): CsaActionItem {
  return {
    id: 'i9_section_2__ent-A__worker-1',
    actionType: 'i9_section_2',
    workerUid: 'worker-1',
    workerName: 'Greg Worker',
    workerEmail: 'greg@example.com',
    workerPhone: '+15555550100',
    workerAvatarUrl: null,
    entityId: 'ent-A',
    entityName: 'C1 Select',
    entityKey: 'select',
    entityEmploymentId: 'emp-1',
    context: {
      hireDate: null,
      i9Section1SignedAt: null,
      i9FullySignedAt: null,
      everifyTncReceivedAt: null,
      everifyStatus: null,
    },
    ageMs: 60_000,
    priority: 1,
    ...overrides,
  };
}

function renderQueue() {
  return render(
    <MemoryRouter>
      <CsaActionQueue tenantId="tenant-1" />
    </MemoryRouter>,
  );
}

describe('E.7 — CsaActionQueue rendering + interactions', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    mockUseHook.mockReset();
  });

  it('renders the empty state when there are no items', () => {
    mockUseHook.mockReturnValue({ items: [], loading: false, error: null });
    renderQueue();
    expect(screen.getByTestId('csa-action-queue-empty')).toBeInTheDocument();
    expect(
      screen.getByText(/All caught up — no action items pending/),
    ).toBeInTheDocument();
  });

  it('renders an I-9 Section 2 item with the correct title + button', () => {
    mockUseHook.mockReturnValue({
      items: [makeItem()],
      loading: false,
      error: null,
    });
    renderQueue();
    expect(
      screen.getByText('Complete I-9 Section 2 — Greg Worker'),
    ).toBeInTheDocument();
    const item = screen.getByTestId(
      'csa-action-queue-item-i9_section_2__ent-A__worker-1',
    );
    expect(within(item).getByText('Mark complete')).toBeInTheDocument();
  });

  it('renders a Start E-Verify item with the correct title + button', () => {
    mockUseHook.mockReturnValue({
      items: [
        makeItem({
          id: 'start_everify__ent-A__worker-1',
          actionType: 'start_everify',
          priority: 2,
        }),
      ],
      loading: false,
      error: null,
    });
    renderQueue();
    expect(
      screen.getByText('Start E-Verify case — Greg Worker'),
    ).toBeInTheDocument();
    // The chip label and button label both say "Start E-Verify" — assert
    // on the button via its test-id to disambiguate.
    expect(
      screen.getByTestId('csa-action-queue-button-start_everify__ent-A__worker-1'),
    ).toHaveTextContent('Start E-Verify');
  });

  it('renders an Address TNC item with the correct title + button', () => {
    mockUseHook.mockReturnValue({
      items: [
        makeItem({
          id: 'address_tnc__ent-A__worker-1',
          actionType: 'address_tnc',
          priority: 0,
        }),
      ],
      loading: false,
      error: null,
    });
    renderQueue();
    expect(
      screen.getByText('Address E-Verify TNC — Greg Worker'),
    ).toBeInTheDocument();
    const item = screen.getByTestId('csa-action-queue-item-address_tnc__ent-A__worker-1');
    expect(within(item).getByText('Open TNC flow')).toBeInTheDocument();
  });

  it('clicking Mark complete opens the I-9 Section 2 dialog', () => {
    mockUseHook.mockReturnValue({
      items: [makeItem()],
      loading: false,
      error: null,
    });
    renderQueue();
    fireEvent.click(
      screen.getByTestId(
        'csa-action-queue-button-i9_section_2__ent-A__worker-1',
      ),
    );
    expect(screen.getByTestId('i9-section2-dialog-stub')).toHaveTextContent(
      'I9 dialog open for Greg Worker',
    );
  });

  it('clicking Start E-Verify navigates to the user profile with employmentScrollTo=e_verify', () => {
    mockUseHook.mockReturnValue({
      items: [
        makeItem({
          id: 'start_everify__ent-A__worker-1',
          actionType: 'start_everify',
          priority: 2,
        }),
      ],
      loading: false,
      error: null,
    });
    renderQueue();
    fireEvent.click(
      screen.getByTestId(
        'csa-action-queue-button-start_everify__ent-A__worker-1',
      ),
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const dest = String(mockNavigate.mock.calls[0][0]);
    expect(dest).toContain('/users/worker-1');
    expect(dest).toContain('employmentScrollTo=e_verify');
    expect(dest).toContain('employmentEntityKey=select');
  });

  it('clicking Open TNC flow navigates to the user profile with the same R.5 anchor', () => {
    mockUseHook.mockReturnValue({
      items: [
        makeItem({
          id: 'address_tnc__ent-A__worker-1',
          actionType: 'address_tnc',
          priority: 0,
        }),
      ],
      loading: false,
      error: null,
    });
    renderQueue();
    fireEvent.click(
      screen.getByTestId('csa-action-queue-button-address_tnc__ent-A__worker-1'),
    );
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const dest = String(mockNavigate.mock.calls[0][0]);
    expect(dest).toContain('/users/worker-1');
    expect(dest).toContain('employmentScrollTo=e_verify');
  });

  it('search bar filters items by worker name (case-insensitive)', () => {
    mockUseHook.mockReturnValue({
      items: [
        makeItem({
          id: 'i9_section_2__ent-A__worker-1',
          workerUid: 'worker-1',
          workerName: 'Greg Worker',
        }),
        makeItem({
          id: 'i9_section_2__ent-A__worker-2',
          workerUid: 'worker-2',
          workerName: 'Frances Falcon',
        }),
      ],
      loading: false,
      error: null,
    });
    renderQueue();

    expect(
      screen.getByTestId('csa-action-queue-item-i9_section_2__ent-A__worker-1'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('csa-action-queue-item-i9_section_2__ent-A__worker-2'),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/Search by name, email, or phone/), {
      target: { value: 'falcon' },
    });

    expect(
      screen.queryByTestId('csa-action-queue-item-i9_section_2__ent-A__worker-1'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId('csa-action-queue-item-i9_section_2__ent-A__worker-2'),
    ).toBeInTheDocument();
  });

  it('renders the My / All scope toggle', () => {
    mockUseHook.mockReturnValue({ items: [], loading: false, error: null });
    renderQueue();
    expect(screen.getByLabelText('My users')).toBeInTheDocument();
    expect(screen.getByLabelText('All users')).toBeInTheDocument();
  });

  it('passes scope=mine to the hook by default for non-HRX users', () => {
    mockUseHook.mockReturnValue({ items: [], loading: false, error: null });
    renderQueue();
    const lastCall = mockUseHook.mock.calls[mockUseHook.mock.calls.length - 1];
    expect(lastCall[0]).toMatchObject({ scope: 'mine', currentUserUid: 'csa-1' });
  });

  it('renders a loading spinner when the hook reports loading=true', () => {
    mockUseHook.mockReturnValue({ items: [], loading: true, error: null });
    renderQueue();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('renders an error alert when the hook reports an error', () => {
    mockUseHook.mockReturnValue({
      items: [],
      loading: false,
      error: 'Something exploded',
    });
    renderQueue();
    expect(screen.getByText(/Something exploded/)).toBeInTheDocument();
  });

  it('priority chip differs by action type', () => {
    mockUseHook.mockReturnValue({
      items: [
        makeItem({
          id: 'address_tnc__ent-A__worker-1',
          actionType: 'address_tnc',
          priority: 0,
        }),
      ],
      loading: false,
      error: null,
    });
    renderQueue();
    expect(screen.getByText(/TNC — federal deadline/)).toBeInTheDocument();
  });
});
