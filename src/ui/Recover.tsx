import { Component, type ReactNode } from "react";
import { STORAGE_KEY } from "./App";

/**
 * Last-resort error boundary. The session tape is replayed on launch, so a
 * bad saved state could otherwise crash the installed app on every start.
 */
export class Recover extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  reset = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* blocked */
    }
    location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="recover">
        <p className="logo">QC-1</p>
        <p>E: {this.state.error.message}</p>
        <button onClick={this.reset}>Clear session and restart</button>
      </div>
    );
  }
}
