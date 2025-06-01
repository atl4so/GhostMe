import { OneLiner } from "./OneLiner";
import { Routes, Route } from "react-router-dom";
import "./styles/api-messages.css";

function App() {
  return (
    <Routes>
      <Route path="/" element={<OneLiner />} />
    </Routes>
  );
}

export default App;
