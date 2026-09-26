import { mount } from './embed';

const host = document.getElementById('app');
const params = new URLSearchParams(location.search);
const demo = params.get('demo') ?? undefined;
if (host) mount(host, { demo, engine: params.get('engine') === '2' ? 2 : 1 });
