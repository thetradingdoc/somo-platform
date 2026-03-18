import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { Search } from './Search';
import { RoleSelect } from './RoleSelect';
import { useRAGSearch } from './useRAGSearch';

function Root() {
  const { query, setQuery, cards, loading, error, empty } = useRAGSearch();

  return (
    <>
      <App cards={cards} />
      <div className="ui-layer">
        <header className="brand">
          <h1>Consʌlt</h1>
          <p>Home Care Works</p>
        </header>
        <Search
          query={query}
          setQuery={setQuery}
          loading={loading}
          error={error}
          empty={empty}
        />
        <RoleSelect query={query} />
      </div>
    </>
  );
}

const container = document.getElementById('root');
createRoot(container).render(<Root />);

