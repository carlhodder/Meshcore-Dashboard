import { Route, Switch } from "wouter";
import Dashboard from "./pages/Dashboard";
import MapPage from "./pages/MapPage";
import Messages from "./pages/Messages";
import Packets from "./pages/Packets";
import Logs from "./pages/Logs";
import Settings from "./pages/Settings";
import Header from "./components/Header";

export function App() {
  return (
    <>
      <Header />
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/map" component={MapPage} />
        <Route path="/messages" component={Messages} />
        <Route path="/packets" component={Packets} />
        <Route path="/logs" component={Logs} />
        <Route path="/settings" component={Settings} />
        <Route>404 Not Found</Route>
      </Switch>
    </>
  );
}
