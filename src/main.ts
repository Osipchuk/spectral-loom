import { mount } from './embed';
import './page.css';

const host = document.getElementById('app');
const params = new URLSearchParams(location.search);
const demo = params.get('demo') ?? undefined;
if (host) mount(host, { demo });
