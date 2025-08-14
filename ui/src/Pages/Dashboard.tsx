import NavigationBar from "../components/Navigationbar";
import { Outlet } from "react-router-dom";

const Dashboard = (props:{user:any|null}) => {
    // Change the browser tab name to 'Dashboard'
    document.title = 'Fleet Hub';

    return (
        <>
            <NavigationBar user={props.user}/>
            <Outlet />
        </>
    );
}

export default Dashboard;
