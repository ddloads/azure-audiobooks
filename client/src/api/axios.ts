import axios from "axios";
import { getApiBaseUrl } from "./backend";

const api = axios.create({
  baseURL: getApiBaseUrl(),
  withCredentials: true,
});

export default api;
