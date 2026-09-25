import { mount } from './embed';

const host = document.getElementById('app');
const demo = new URLSearchParams(location.search).get('demo') ?? undefined;
if (host) mount(host, { demo });
