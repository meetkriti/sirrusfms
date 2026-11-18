import { Component, type ReactNode } from "react";

/** Keeps one broken page from blanking the whole demo. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div className="m-6 rounded-xl border border-red-200 bg-white p-5 text-sm shadow-sm">
          <div className="mb-1 font-semibold text-red-700">This page hit an error</div>
          <p className="text-slate-600">{this.state.error.message}</p>
          <p className="mt-2 text-slate-500">Use the left navigation to continue the demo, or reset the demo data (↺ in the top bar).</p>
        </div>
      );
    return this.props.children;
  }
}
