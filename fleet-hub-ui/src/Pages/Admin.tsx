import { Alert, Container, Tab, Tabs } from 'react-bootstrap';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faInfoCircle, faMicrochip, faUnlockKeyhole, faUser } from '@fortawesome/free-solid-svg-icons';
import { Navigate } from 'react-router-dom';
import AdminDevices from '../components/Admin/AdminDevices';
import AdminUsers from '../components/Admin/AdminUsers';

function Admin(props:{user:any}) {

  // If someone gets here without administration access,
  // return to the main page of the Fleet Hub
  if(props?.user?.roles?.indexOf("admin") <= -1){
    return <Navigate to="/dashboard"/>
  }

  return (
      <Container style={{textAlign:'left'}}>
        <br/>
        <h2><FontAwesomeIcon icon={faUnlockKeyhole}/> Admin tools</h2>
        <p>Tools for administration of the Edgeberry Fleet Hub</p>
        <hr/>
        <Tabs defaultActiveKey="devices" className="mb-3">
          <Tab eventKey="users" title={<><FontAwesomeIcon icon={faUser} /> Users</>}>
            <Alert><FontAwesomeIcon icon={faInfoCircle}/> Tools for managing the Fleet Hub users.</Alert>
            <AdminUsers user={props.user} />
          </Tab>
          <Tab eventKey="devices" title={<><FontAwesomeIcon icon={faMicrochip}/> Devices</>}>
            <Alert><FontAwesomeIcon icon={faInfoCircle}/> Tools for managing the devices.</Alert>
            <AdminDevices user={props.user} />
          </Tab>
        </Tabs>
      </Container>
  );
}

export default Admin;